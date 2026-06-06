"""Pipeline orchestrator: load -> chunk -> extract -> ingest, with SSE progress."""
from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.session import state
from app.pipeline.extractor import extract_from_chunk, sanitize_label
from app.pipeline.loaders import load_any
from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service


async def _push(message: str, **extras):
    """Update progress state and broadcast to SSE subscribers."""
    state.progress["message"] = message
    state.progress.update(extras)
    await state.broadcast("progress", dict(state.progress))


async def run_pipeline(sources: Iterable[str], clear_existing: bool = False) -> dict:
    """Run the full ingest pipeline for the given sources (paths or URLs).

    Sources are processed sequentially; chunk extraction within each source
    is parallelised across a thread pool.
    """
    if not state.neo4j_connected:
        raise RuntimeError("Neo4j not connected.")
    if not state.llm_provider or not state.llm_model:
        raise RuntimeError("LLM not configured.")


    llm = get_llm()
    loop = asyncio.get_running_loop()

    state.progress.update(
        stage="loading", chunks_total=0, chunks_processed=0,
        triples_extracted=0, triples_ingested=0,
    )
    await _push("Loading sources…")

    docs = []
    for src in sources:
        try:
            loaded = await loop.run_in_executor(None, load_any, src)
            docs.extend(loaded)
            await _push(f"Loaded {src} ({len(loaded)} docs)")
        except Exception as e:
            await _push(f"Failed to load {src}: {e}")

    if not docs:
        await _push("No documents loaded.", stage="idle")
        return {"ok": False, "reason": "no documents"}

    state.progress["stage"] = "chunking"
    await _push("Chunking documents…")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=state.chunk_size, chunk_overlap=state.chunk_overlap,
    )
    chunks = splitter.split_documents(docs)
    state.progress["chunks_total"] = len(chunks)
    await _push(f"Created {len(chunks)} chunks")
    # llm = get_llm()

    # # Reset counters
    # state.progress.update(
    #     stage="loading", chunks_total=0, chunks_processed=0,
    #     triples_extracted=0, triples_ingested=0,
    # )
    # await _push("Loading sources…")

    # # 1. Load
    # docs = []
    # for src in sources:
    #     try:
    #         docs.extend(load_any(src))
    #         await _push(f"Loaded {src}")
    #     except Exception as e:
    #         await _push(f"Failed to load {src}: {e}")

    # if not docs:
    #     await _push("No documents loaded.", stage="idle")
    #     return {"ok": False, "reason": "no documents"}

    # # 2. Chunk
    # state.progress["stage"] = "chunking"
    # await _push("Chunking documents…")
    # splitter = RecursiveCharacterTextSplitter(
    #     chunk_size=state.chunk_size, chunk_overlap=state.chunk_overlap,
    # )
    # chunks = splitter.split_documents(docs)
    # state.progress["chunks_total"] = len(chunks)
    # await _push(f"Created {len(chunks)} chunks")

    # 3. Optionally clear graph
    if clear_existing:
        await neo4j_service.run("MATCH (n) DETACH DELETE n")
        await _push("Cleared existing graph")

    # 4. Extract triples in parallel (LLM calls are I/O-bound)
    state.progress["stage"] = "extracting"
    state.progress["chunks_failed"] = 0
    await _push("Extracting triples…")
    all_triples: list[dict] = []
    failures: list[str] = []

    def _work(text: str) -> tuple[list[dict], str | None]:
        max_retries = 5
        base_delay = 7.0  # Wait 7 seconds on the first failure (covers the 6.53s request)

        for attempt in range(max_retries):
            try:
                # If successful, return the triples and exit the retry loop
                return extract_from_chunk(text, llm), None
            except Exception as exc:
                err_msg = str(exc)
                
                # Check if the error is a rate limit (429)
                is_rate_limit = any(keyword in err_msg.lower() for keyword in ["429", "rate limit", "too many requests"])
                
                if is_rate_limit and attempt < max_retries - 1:
                    # Exponential backoff: 7s, 14s, 28s...
                    sleep_time = base_delay * (2 ** attempt)
                    print(f"[pipeline] Rate limit hit. Worker pausing for {sleep_time}s... (Attempt {attempt+1}/{max_retries})", flush=True)
                    
                    # time.sleep is safe here because _work runs inside a ThreadPoolExecutor 
                    # and won't block the main asyncio event loop.
                    time.sleep(sleep_time)
                    continue  # Try again
                
                # If it's not a rate limit error, or we ran out of retries, fail permanently
                return [], f"{type(exc).__name__}: {exc}"

    # Default to 4 workers — Groq free tier rate-limits aggressively at 8.
    workers = int(getattr(state, "extraction_workers", 4) or 4)
    batch_size = workers  # Process one full worker queue at a time
    batch_delay = getattr(state, "extraction_delay", 2.0)  # 2-second pause between batches
    
    processed_count = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Loop through chunks in batches
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            
            # Submit only the current batch to the executor
            futures = [loop.run_in_executor(pool, _work, c.page_content) for c in batch]
            
            # Await completion of the current batch, updating progress as they finish
            for fut in asyncio.as_completed(futures):
                triples, err = await fut
                processed_count += 1
                
                if err:
                    failures.append(err)
                    state.progress["chunks_failed"] = len(failures)
                    print(f"[pipeline] chunk {processed_count} failed: {err}", flush=True)
                
                all_triples.extend(triples)
                state.progress["chunks_processed"] = processed_count
                state.progress["triples_extracted"] = len(all_triples)
                
                # Push SSE updates
                if processed_count % 2 == 0 or processed_count == len(chunks):
                    msg = f"Extracted {len(all_triples)} triples from {processed_count}/{len(chunks)} chunks"
                    if failures:
                        msg += f" ({len(failures)} failed)"
                    await _push(msg)
            
            # Apply rate-limit delay before submitting the next batch (skip on the last batch)
            if i + batch_size < len(chunks):
                await asyncio.sleep(batch_delay)

    if failures:
        # Surface a sample to the UI; full list went to backend log
        sample = "; ".join(failures[:3])
        await _push(
            f"{len(failures)}/{len(chunks)} chunks failed during extraction. First errors: {sample}"
        )

    # 5. Ingest into Neo4j
    state.progress["stage"] = "ingesting"
    await _push("Ingesting into Neo4j…")
    ingested = 0
    ingest_failures = 0
    for t in all_triples:
        rel = t["relation"]
        s_label = sanitize_label(t.get("subject_type", "Other"))
        o_label = sanitize_label(t.get("object_type", "Other"))
        # Also tag with :Entity so legacy queries still match.
        cypher = f"""
        MERGE (s:`{s_label}` {{name: $s}})
        SET s:Entity
        MERGE (o:`{o_label}` {{name: $o}})
        SET o:Entity
        MERGE (s)-[:`{rel}`]->(o)
        """
        try:
            await neo4j_service.run(cypher, {"s": t["subject"], "o": t["object"]})
            ingested += 1
            if ingested % 25 == 0:
                state.progress["triples_ingested"] = ingested
                await _push(f"Ingested {ingested}/{len(all_triples)}")
        except Exception as exc:
            ingest_failures += 1
            if ingest_failures <= 5:
                print(f"[pipeline] ingest failed for {t}: {exc}", flush=True)
            continue

    state.progress["triples_ingested"] = ingested
    state.progress["stage"] = "done"
    await _push(f"Done. {ingested} relationships in Neo4j.")
    return {"ok": True, "chunks": len(chunks), "triples": len(all_triples), "ingested": ingested}
