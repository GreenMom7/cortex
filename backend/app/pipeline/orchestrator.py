"""Pipeline orchestrator: load -> chunk -> extract -> ingest, with SSE progress."""
from __future__ import annotations

import asyncio
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
    await _push("Extracting triples…")
    all_triples: list[dict] = []

    def _work(text: str) -> list[dict]:
        try:
            return extract_from_chunk(text, llm)
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [loop.run_in_executor(pool, _work, c.page_content) for c in chunks]
        for i, fut in enumerate(asyncio.as_completed(futures), 1):
            triples = await fut
            all_triples.extend(triples)
            state.progress["chunks_processed"] = i
            state.progress["triples_extracted"] = len(all_triples)
            if i % 2 == 0 or i == len(chunks):
                await _push(f"Extracted {len(all_triples)} triples from {i}/{len(chunks)} chunks")

    # 5. Ingest into Neo4j
    state.progress["stage"] = "ingesting"
    await _push("Ingesting into Neo4j…")
    ingested = 0
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
        except Exception:
            continue

    state.progress["triples_ingested"] = ingested
    state.progress["stage"] = "done"
    await _push(f"Done. {ingested} relationships in Neo4j.")
    return {"ok": True, "chunks": len(chunks), "triples": len(all_triples), "ingested": ingested}
