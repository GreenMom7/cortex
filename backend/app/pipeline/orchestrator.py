"""Pipeline orchestrator: load -> chunk -> persist (Document+Chunk) -> extract -> ingest, with SSE progress."""
from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.session import state
from app.pipeline.extractor import extract_from_chunk, sanitize_label
from app.pipeline.loaders import load_any
from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service


def _get_embed_model():
    """Reuse the same SentenceTransformer instance loaded by chat_service."""
    from app.services.chat_service import SIMILARITY_MODEL
    if SIMILARITY_MODEL is not None:
        return SIMILARITY_MODEL
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(state.embedding_model or "BAAI/bge-base-en-v1.5")


async def _push(message: str, **extras):
    """Update progress state and broadcast to SSE subscribers."""
    state.progress["message"] = message
    state.progress.update(extras)
    await state.broadcast("progress", dict(state.progress))


async def run_pipeline(sources: Iterable[str], clear_existing: bool = False, entity_types: list[str] | None = None) -> dict:
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
    state.skip_extraction = False

    state.progress.update(
        stage="loading", chunks_total=0, chunks_processed=0,
        chunks_persisted=0, triples_extracted=0, triples_ingested=0,
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

    # Optionally clear graph
    if clear_existing:
        await neo4j_service.run("MATCH (n) DETACH DELETE n")
        try:
            await neo4j_service.run("DROP INDEX chunk_embedding IF EXISTS")
        except Exception:
            pass
        await _push("Cleared existing graph")

    # Ensure vector index exists
    await neo4j_service.ensure_vector_index()

    # ── Persist Document + Chunk nodes ──────────────────────────────────
    state.progress["stage"] = "persisting"
    await _push("Persisting documents and chunks…")

    # Group chunks by source document
    chunks_by_source: dict[str, list] = defaultdict(list)
    for chunk in chunks:
        source = chunk.metadata.get("source", "unknown")
        chunks_by_source[source].append(chunk)

    embed_model = _get_embed_model()
    # Build a mapping from chunk object id -> index for fast lookup
    chunk_obj_to_idx = {id(c): i for i, c in enumerate(chunks)}
    chunk_id_map: dict[int, str] = {}  # maps chunk index in `chunks` -> chunkId

    for source, source_chunks in chunks_by_source.items():
        file_name = os.path.basename(source) if source != "unknown" else "unknown"
        file_type = os.path.splitext(file_name)[1].lstrip(".") if file_name != "unknown" else ""

        # Create or update Document node
        await neo4j_service.run(
            "MERGE (d:Document {fileName: $fileName}) "
            "SET d.fileSource = $fileSource, d.fileType = $fileType",
            {"fileName": file_name, "fileSource": source, "fileType": file_type},
        )

        # Remove old chunks for this document (handles re-ingestion)
        await neo4j_service.run(
            "MATCH (d:Document {fileName: $fn})<-[:PART_OF]-(c:Chunk) DETACH DELETE c",
            {"fn": file_name},
        )

        # Compute embeddings in batch
        texts = [c.page_content for c in source_chunks]
        embeddings = await loop.run_in_executor(
            None, lambda t=texts: embed_model.encode(t, normalize_embeddings=True).tolist()
        )

        # Create Chunk nodes with embeddings — batched to reduce Neo4j round-trips
        chunk_ids_for_source = []
        chunk_batch = []
        for pos, (chunk, emb) in enumerate(zip(source_chunks, embeddings)):
            chunk_id = f"{file_name}_{pos}"
            original_idx = chunk_obj_to_idx.get(id(chunk), pos)
            chunk_id_map[original_idx] = chunk_id
            chunk_ids_for_source.append(chunk_id)
            chunk_batch.append({
                "chunkId": chunk_id,
                "text": chunk.page_content,
                "position": pos,
                "embedding": emb,
            })

        # Batch-create all chunks + PART_OF links in one query via UNWIND
        if chunk_batch:
            await neo4j_service.run(
                "UNWIND $chunks AS c "
                "CREATE (ch:Chunk {chunkId: c.chunkId, text: c.text, position: c.position, embedding: c.embedding}) "
                "WITH ch "
                "MATCH (d:Document {fileName: $fileName}) "
                "CREATE (ch)-[:PART_OF]->(d)",
                {"chunks": chunk_batch, "fileName": file_name},
            )

        state.progress["chunks_persisted"] = state.progress.get("chunks_persisted", 0) + len(chunk_batch)
        await _push(f"Persisted {state.progress['chunks_persisted']}/{len(chunks)} chunks")

        # Batch-create NEXT_CHUNK sequential links in one query
        if len(chunk_ids_for_source) > 1:
            pairs = [
                {"id1": chunk_ids_for_source[i], "id2": chunk_ids_for_source[i + 1]}
                for i in range(len(chunk_ids_for_source) - 1)
            ]
            await neo4j_service.run(
                "UNWIND $pairs AS p "
                "MATCH (c1:Chunk {chunkId: p.id1}) "
                "MATCH (c2:Chunk {chunkId: p.id2}) "
                "CREATE (c1)-[:NEXT_CHUNK]->(c2)",
                {"pairs": pairs},
            )

    await _push(f"Persisted {len(chunks)} chunks across {len(chunks_by_source)} document(s)")

    # ── Extract triples in parallel (LLM calls are I/O-bound) ──────────
    state.progress["stage"] = "extracting"
    state.progress["chunks_failed"] = 0
    await _push("Extracting triples…")
    all_triples: list[dict] = []
    failures: list[str] = []

    def _interruptible_sleep(seconds: float) -> None:
        """Sleep in short slices so a skip request can cut a long retry backoff short."""
        end = time.monotonic() + seconds
        while time.monotonic() < end and not state.skip_extraction:
            time.sleep(0.2)

    def _work(text: str, chunk_id: str) -> tuple[list[dict], str | None]:
        max_retries = 5
        base_delay = 7.0

        for attempt in range(max_retries):
            if state.skip_extraction:
                return [], None  # user asked to stop; skip this chunk (not a failure)
            try:
                triples = extract_from_chunk(text, llm, entity_types=entity_types)
                for t in triples:
                    t["_chunk_id"] = chunk_id
                return triples, None
            except Exception as exc:
                err_msg = str(exc)
                is_rate_limit = any(keyword in err_msg.lower() for keyword in ["429", "rate limit", "too many requests"])

                if is_rate_limit and attempt < max_retries - 1:
                    sleep_time = base_delay * (2 ** attempt)
                    print(f"[pipeline] Rate limit hit. Worker pausing for {sleep_time}s... (Attempt {attempt+1}/{max_retries})", flush=True)
                    _interruptible_sleep(sleep_time)
                    continue

                return [], f"{type(exc).__name__}: {exc}"

    workers = int(getattr(state, "extraction_workers", 4) or 4)
    batch_size = workers
    batch_delay = getattr(state, "extraction_delay", 2.0)

    processed_count = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i in range(0, len(chunks), batch_size):
            if state.skip_extraction:
                break
            batch = chunks[i:i + batch_size]
            batch_chunk_ids = [chunk_id_map.get(i + j, f"unknown_{i+j}") for j in range(len(batch))]

            futures = [
                loop.run_in_executor(pool, _work, c.page_content, cid)
                for c, cid in zip(batch, batch_chunk_ids)
            ]

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

                if processed_count % 2 == 0 or processed_count == len(chunks):
                    msg = f"Extracted {len(all_triples)} triples from {processed_count}/{len(chunks)} chunks"
                    if failures:
                        msg += f" ({len(failures)} failed)"
                    await _push(msg)

            if i + batch_size < len(chunks):
                await asyncio.sleep(batch_delay)

    if state.skip_extraction:
        await _push(
            f"Extraction stopped by user — ingesting {len(all_triples)} triples "
            f"from {processed_count}/{len(chunks)} chunks"
        )
        state.skip_extraction = False

    if failures:
        sample = "; ".join(failures[:3])
        await _push(
            f"{len(failures)}/{len(chunks)} chunks failed during extraction. First errors: {sample}"
        )

    # ── Ingest into Neo4j (Entity nodes + HAS_ENTITY links) ────────────
    # Group triples by (subject_label, object_label, relation) so we can batch
    # them in single UNWIND queries. This reduces ~500 round-trips to ~20-50.
    state.progress["stage"] = "ingesting"
    await _push("Ingesting into Neo4j…")
    ingested = 0
    ingest_failures = 0

    # Group by (s_label, o_label, relation) — Cypher can't parameterize labels/types
    triple_groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for t in all_triples:
        s_label = sanitize_label(t.get("subject_type", "Other"))
        o_label = sanitize_label(t.get("object_type", "Other"))
        rel = t["relation"]
        triple_groups[(s_label, o_label, rel)].append({
            "s": t["subject"], "o": t["object"], "chunkId": t.get("_chunk_id", ""),
        })

    for (s_label, o_label, rel), batch in triple_groups.items():
        # Split into sub-batches of 50 to avoid oversized transactions
        for i in range(0, len(batch), 50):
            sub = batch[i:i + 50]
            has_chunks = any(item["chunkId"] for item in sub)

            cypher = f"""
            UNWIND $items AS t
            MERGE (s:`{s_label}` {{name: t.s}})
            SET s:Entity
            MERGE (o:`{o_label}` {{name: t.o}})
            SET o:Entity
            MERGE (s)-[:`{rel}`]->(o)
            """
            if has_chunks:
                cypher += """
                WITH s, o, t
                FOREACH (_ IN CASE WHEN t.chunkId <> '' THEN [1] ELSE [] END |
                    MERGE (c:Chunk {chunkId: t.chunkId})
                    MERGE (c)-[:HAS_ENTITY]->(s)
                    MERGE (c)-[:HAS_ENTITY]->(o)
                )
                """

            try:
                await neo4j_service.run(cypher, {"items": sub})
                ingested += len(sub)
                state.progress["triples_ingested"] = ingested
                await _push(f"Ingested {ingested}/{len(all_triples)}")
            except Exception as exc:
                # Fall back to one-by-one for this batch
                for item in sub:
                    single_cypher = f"""
                    MERGE (s:`{s_label}` {{name: $s}})
                    SET s:Entity
                    MERGE (o:`{o_label}` {{name: $o}})
                    SET o:Entity
                    MERGE (s)-[:`{rel}`]->(o)
                    """
                    if item["chunkId"]:
                        single_cypher += """
                        WITH s, o
                        MATCH (c:Chunk {chunkId: $chunkId})
                        MERGE (c)-[:HAS_ENTITY]->(s)
                        MERGE (c)-[:HAS_ENTITY]->(o)
                        """
                    try:
                        await neo4j_service.run(single_cypher, item)
                        ingested += 1
                    except Exception as inner_exc:
                        ingest_failures += 1
                        if ingest_failures <= 5:
                            print(f"[pipeline] ingest failed: {inner_exc}", flush=True)
                state.progress["triples_ingested"] = ingested

    state.progress["triples_ingested"] = ingested
    state.progress["stage"] = "done"
    await _push(f"Done. {ingested} relationships in Neo4j.")
    return {"ok": True, "chunks": len(chunks), "triples": len(all_triples), "ingested": ingested}
