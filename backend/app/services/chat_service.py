"""GraphRAG chat service.

Given a user question:
1. Rewrite follow-up questions to be self-contained.
2. Ask the LLM to generate a Cypher query (text-to-Cypher).
3. Execute the Cypher and collect entities + relationships used.
4. If the Cypher fails or returns no relationships, fall back to an entity-extraction
   query: the LLM extracts named entities, and we run a fixed 1-hop neighborhood query.
5. Format the retrieved subgraph as natural-sentence context.
6. Ask the LLM to produce a final natural-language answer.
7. Return answer + cypher + retrieved node/edge ids + reasoning steps.

The frontend uses node_ids / edge_ids to highlight the graph in green.
"""
from __future__ import annotations

import re
import logging
from typing import Any

import torch
from sentence_transformers import SentenceTransformer, util

from app.core.session import state
from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service

import time

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Semantic Scorer — loaded once globally
# ---------------------------------------------------------------------------
try:
    SIMILARITY_MODEL = SentenceTransformer("BAAI/bge-base-en-v1.5")
except Exception as e:
    log.error("Failed to load local embedding model for scoring: %s", e)
    SIMILARITY_MODEL = None


REWRITE_PROMPT = """You rewrite follow-up questions into self-contained questions.

Given the conversation so far and a new question, output a single self-contained version of the new question:
- Resolve pronouns ("her", "his", "they", "that", "those") to the specific entity mentioned in the prior turns.
- Expand elliptical questions ("her title?" → "What is Kösem Sultan's title?", "and his children?" → "Who are Mehmed IV's children?").
- If the new question is already self-contained, return it unchanged.
- Output ONLY the rewritten question. No preface, no quotes, no explanation.

Conversation so far:
{history}

New question: {question}

Rewritten question:"""


CYPHER_PROMPT = """You are a Neo4j Cypher expert. Generate ONE read-only Cypher query against a knowledge graph extracted from documents.

Graph schema:
- Every entity node carries the :Entity label PLUS a type label: :Person, :Place, :Organization, :Event, :Date, :Work, :Concept, :Object, or :Other.
- All entity nodes have a `name` property (the canonical surface form from the source text).
- Relationships between entities are directed; type names are UPPER_SNAKE_CASE (e.g. REIGNED_FROM, FATHER_OF, LOCATED_IN).
- There are also :Document and :Chunk infrastructure nodes, but do NOT query those — focus ONLY on :Entity nodes and inter-entity relationships.

Rules:
1. ALWAYS use the :Entity label in MATCH patterns — NEVER use type labels like :Person or :Place in MATCH.
   Correct: MATCH (n:Entity)-[r]-(m:Entity) WHERE n.name =~ '(?i).*curie.*'
   WRONG:   MATCH (n:Person)-[r]-(m) WHERE n.name =~ '(?i).*curie.*'

2. Match entities by name with a CASE-INSENSITIVE regex that tolerates spelling variation.
   Use `(?i)` and allow either form for diacritics and romanization variants.
   Marie Curie: match with '(?i).*(marie|curie|skłodowska|sklodowska).*'
   Common name variants: Muhammad/Mehmed/Mohammed, Peter/Pyotr/Pierre,
   Constantinople/Istanbul, Suleiman/Süleyman.
   When unsure, prefer a short stem: `mehm.*iv` over an exact name.

3. For single-subject questions ("tell me about X"), return the 1-hop neighborhood:
   MATCH (n:Entity)-[r]-(m:Entity) WHERE n.name =~ '(?i).*X.*' RETURN n, r, m LIMIT 80

4. For two-subject questions ("how is X related to Y"), use shortestPath with UNWIND outside the path:
   MATCH p = shortestPath((a:Entity)-[*..4]-(b:Entity))
   WHERE a.name =~ '(?i).*X.*' AND b.name =~ '(?i).*Y.*'
   UNWIND relationships(p) AS rel
   WITH startNode(rel) AS n, rel AS r, endNode(rel) AS m
   RETURN n, r, m LIMIT 100

5. For questions with 3 or more subjects, use separate MATCH clauses joined by WITH.

6. NEVER nest ANY() inside relationships() or nodes() of a path.
7. NEVER add extra WITH clauses inside a shortestPath MATCH.
8. Always RETURN full node and relationship objects: RETURN n, r, m
   WRONG: RETURN n.name, type(r), m.name   RIGHT: RETURN n, r, m
9. Always include LIMIT (≤ 100).
10. Output Cypher only — no markdown fences, no comments, no prose.
11. For yes/no questions, superlative questions ("first", "only", "most", "best"), or questions
    asking whether a fact is true about a single subject, use the 1-hop neighborhood (rule 3)
    for that subject — do NOT try to match a second entity for the superlative qualifier.

Question: {question}
Cypher:"""


ENTITY_PROMPT = """Extract the main named entities from this question — the specific people, places, organizations, events, or works being asked about.

Rules:
- Return one entity per line, exactly as it appears in the question.
- Return at most 3 entities.
- If no clearly named entity exists, return the most specific noun phrase in the question.
- Output ONLY the entity names, one per line. No explanations, no numbering, no punctuation.

Question: {question}

Entities:"""


ANSWER_PROMPT = """You are a research assistant answering a question using a knowledge graph extracted from documents.

You are given context from two sources:
- Relevant text passages retrieved by semantic similarity from the source documents.
- Knowledge graph facts extracted as structured relationships between entities.

Hard rules for your answer:
1. Write natural prose — like a Wikipedia summary or a knowledgeable friend. NEVER use triple notation like `Subject -[RELATION]-> Object` or `(Subject, RELATION, Object)`. NEVER include UPPER_SNAKE_CASE relation names, arrows (`->`, `-[...]->`), or parenthetical citations of the source triples. Just write sentences.
2. Be thorough. Cover every fact in the context that is relevant to the question. For a "tell me about X" question, write a full paragraph of 4-8 sentences minimum. Do not stop at the first 2-3 facts.
3. The graph is the authoritative source for ALL specific facts (names, dates, places, roles, kinships, events). Do NOT use training data to answer specific factual questions — the graph is built from source documents and your training data may contradict it. If a specific fact is not in the context, say you don't have that information. Never guess or fill in gaps from memory.
4. Names may differ between question and context due to transliteration (e.g. user asks "Muhammad IV", context calls him "Mehmed IV"; "Suleyman" vs "Süleyman"; "Constantinople" vs "Istanbul"). Treat them as the same entity and answer normally.
5. If the context contains facts that let you derive the answer — by counting, listing, or connecting items explicitly stated in the context — do so. Only output exactly one sentence "The knowledge graph does not contain enough information to answer that question." when the answer cannot be derived from the context at all. Do NOT speculate beyond what the context supports and do NOT use background knowledge to fill gaps.
6. Do not preface your answer with phrases like "Based on the context" or "According to the graph". Just answer.

Context:
{context}

Question: {question}

Answer:"""


def _strip_thinking_blocks(text: str) -> str:
    """Remove <think>...</think> and <thinking>...</thinking> blocks emitted by reasoning models."""
    text = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", text, flags=re.DOTALL | re.IGNORECASE)
    return text.strip()


def _strip_cypher_fences(text: str) -> str:
    text = _strip_thinking_blocks(text)
    text = re.sub(r"^```(?:cypher)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    m = re.search(r"(MATCH|CALL|WITH|OPTIONAL MATCH)\b.*", text, re.IGNORECASE | re.DOTALL)
    return (m.group(0) if m else text).strip().rstrip(";")


def _humanize(rel: str) -> str:
    """REIGNED_FROM -> 'reigned from'."""
    return rel.replace("_", " ").lower().strip()


def _collapse_repetition(text: str, min_phrase_words: int = 4, max_repeats: int = 2) -> str:
    """Detect and truncate degenerate-loop output."""
    words = text.split()
    if len(words) > 50:
        positions: dict[tuple, list[int]] = {}
        for i in range(len(words) - 3):
            ng = tuple(w.lower() for w in words[i:i + 4])
            positions.setdefault(ng, []).append(i)
        for ng, locs in positions.items():
            if len(locs) > 3:
                cut = locs[2]
                return " ".join(words[:cut]).rstrip(",.;: ") + "."

    parts = re.split(r"(?:,| but| and| also| or)\s+", text)
    if len(parts) < max_repeats + 2:
        return text

    norm = [p.strip().lower() for p in parts]
    for i in range(len(norm) - max_repeats):
        head = norm[i]
        if len(head.split()) < min_phrase_words:
            continue
        if all(norm[i + k] == head for k in range(1, max_repeats + 1)):
            keep = parts[: i + 1]
            cleaned = (", ".join(p.strip() for p in keep if p.strip())).rstrip(",.;: ")
            return cleaned + "."
    return text


def _format_history(history: list[dict] | None, max_turns: int = 4) -> str:
    if not history:
        return ""
    recent = history[-max_turns:]
    lines = []
    for turn in recent:
        q = (turn.get("question") or "").strip()
        a = (turn.get("answer") or "").strip()
        if q:
            lines.append(f"User: {q}")
        if a:
            if len(a) > 400:
                a = a[:400] + "…"
            lines.append(f"Assistant: {a}")
    return "\n".join(lines)



_STOP_WORDS = frozenset({
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "that", "this", "these", "those", "there", "here",
    "have", "has", "had", "does", "did", "do", "will", "would", "could",
    "should", "shall", "might", "must", "can", "may",
    "been", "being", "were", "was", "are", "is", "am",
    "much", "many", "more", "most", "some", "any", "all", "each", "every",
    "about", "from", "with", "into", "between", "through", "after", "before",
    "also", "than", "then", "very", "just", "only", "such", "like",
    "tell", "know", "think", "make", "give", "take", "come", "find",
    "want", "need", "mean", "keep", "help", "show", "called",
    "the", "and", "but", "for", "not", "you", "your",
})


def _entity_fallback_query(stems: list[str]) -> str:
    """Build a 1-hop neighborhood Cypher from short word stems.

    Uses toLower/CONTAINS instead of regex — simpler, faster, and tolerant of
    partial name matches (e.g. stem "curie" matches "Marie Curie", "Pierre Curie").
    """
    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("'", "\\'")

    conditions = " OR ".join(
        f"toLower(n.name) CONTAINS '{_esc(s)}' OR toLower(m.name) CONTAINS '{_esc(s)}'"
        for s in stems
    )
    if not conditions:
        return "MATCH (n:Entity)-[r]-(m:Entity) RETURN n, r, m LIMIT 50"
    return f"MATCH (n:Entity)-[r]-(m:Entity) WHERE {conditions} RETURN n, r, m LIMIT 100"


async def graphrag_answer(question: str, history: list[dict] | None = None) -> dict[str, Any]:
    start_time = time.perf_counter()

    reasoning: list[dict] = []
    llm = get_llm()
    history_text = _format_history(history)
    chunk_ids: list[str] = []
    passage_texts: list[str] = []
    cached_q_embedding = None

    # Step 0: rewrite follow-up question into a self-contained one
    effective_question = question
    if history_text:
        rewrite_raw = llm.invoke(
            REWRITE_PROMPT.format(history=history_text, question=question)
        )
        rewritten = _strip_thinking_blocks(
            rewrite_raw.content if hasattr(rewrite_raw, "content") else str(rewrite_raw)
        ).strip().strip('"').strip("'")
        if rewritten and len(rewritten) < 500:
            effective_question = rewritten
        reasoning.append({"step": "rewrite_question", "detail": effective_question})

    # Step 0.5: vector search on Chunk nodes for passage retrieval
    if SIMILARITY_MODEL and state.vector_index_available:
        try:
            cached_q_embedding = SIMILARITY_MODEL.encode(effective_question, normalize_embeddings=True)
            q_embedding = cached_q_embedding.tolist()
            vector_results = await neo4j_service.vector_search(q_embedding, top_k=5, threshold=0.65)
            for row in vector_results:
                passage_texts.append(row["text"])
                chunk_ids.append(row["chunkId"])
            reasoning.append({
                "step": "vector_search",
                "detail": f"{len(vector_results)} passage(s) retrieved from chunk embeddings",
            })
        except Exception as e:
            log.warning("Vector search step failed: %s", e)
            reasoning.append({"step": "vector_search", "detail": f"skipped: {e}"})

    # Step 1: generate Cypher from natural language
    cypher_raw = llm.invoke(CYPHER_PROMPT.format(question=effective_question))
    cypher = _strip_cypher_fences(
        cypher_raw.content if hasattr(cypher_raw, "content") else str(cypher_raw)
    )

    # Guard against write operations
    if re.search(r"\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP|DETACH)\b", cypher, re.I):
        return {
            "answer": "I refuse to run that query — it appears to modify the graph.",
            "cypher": cypher,
            "node_ids": [],
            "edge_ids": [],
            "context": "",
            "reasoning": reasoning + [{"step": "guard", "detail": "Write operation blocked."}],
            "scores": {"retrieval": 0.0, "confidence": 0.0},
            "execution_time": round(time.perf_counter() - start_time, 2),
        }

    reasoning.append({"step": "generate_cypher", "detail": cypher})
    log.info("Generated Cypher: %s", cypher)

    sentences: list[str] = []
    seen_sentences: set[str] = set()
    node_ids: set[str] = set()
    edge_ids: set[str] = set()
    used_cypher = cypher

    def _collect_sentences(record):
        """Extract one (subject, predicate, object) sentence from a Neo4j record."""
        rec_nodes, rec_rel = [], None
        for v in record.values():
            if v is None:
                continue
            if hasattr(v, "type") and hasattr(v, "start_node"):
                rec_rel = v
                edge_ids.add(v.element_id)
            elif hasattr(v, "labels"):
                rec_nodes.append(v)
                node_ids.add(v.element_id)
        if rec_rel is not None and len(rec_nodes) >= 2:
            s_name = dict(rec_nodes[0]).get("name", "?")
            o_name = dict(rec_nodes[1]).get("name", "?")
            sentence = f"{s_name} {_humanize(rec_rel.type)} {o_name}."
            if sentence not in seen_sentences:
                seen_sentences.add(sentence)
                sentences.append(sentence)

    # Step 2: execute the LLM-generated Cypher (process records INSIDE the session
    # so that relationship.start_node / .end_node are still live objects)
    try:
        record_count = 0
        async with neo4j_service.driver.session() as sess:
            result = await sess.run(cypher)
            async for record in result:
                record_count += 1
                _collect_sentences(record)

        log.info("Cypher returned %d records → %d sentences, %d nodes, %d edges",
                 record_count, len(sentences), len(node_ids), len(edge_ids))
        reasoning.append({"step": "execute_cypher", "detail": f"{len(node_ids)} nodes, {len(edge_ids)} edges"})

        if not sentences:
            raise RuntimeError("Cypher returned no relationship sentences")

    except Exception as e:
        log.warning("Cypher failed or empty (%s) — falling back to stem query.", e)

        stems = [
            w.strip('?,."\'():;!').lower()
            for w in effective_question.split()
            if len(w.strip('?,."\'():;!')) > 3
            and w.strip('?,."\'():;!').lower() not in _STOP_WORDS
        ][:6]
        if not stems:
            stems = [
                w.strip('?,."\'():;!').lower()
                for w in effective_question.split()
                if w.strip('?,."\'():;!').lower() not in _STOP_WORDS
            ][:4]

        fallback_cypher = _entity_fallback_query(stems)
        used_cypher = fallback_cypher
        reasoning.append({"step": "fallback_cypher", "detail": fallback_cypher})

        try:
            async with neo4j_service.driver.session() as sess:
                result = await sess.run(fallback_cypher)
                async for record in result:
                    _collect_sentences(record)

            reasoning.append({
                "step": "execute_cypher",
                "detail": f"{len(node_ids)} nodes, {len(edge_ids)} edges (fallback)",
            })

        except Exception as e2:
            return {
                "answer": "The graph could not be queried. Please try rephrasing your question.",
                "cypher": fallback_cypher,
                "node_ids": [],
                "edge_ids": [],
                "context": "",
                "reasoning": reasoning + [{"step": "error", "detail": str(e2)}],
                "scores": {"retrieval": 0.0, "confidence": 0.0},
                "execution_time": round(time.perf_counter() - start_time, 2),
            }

    # Build combined context from passages (vector search) + graph facts
    context_parts = []
    if passage_texts:
        context_parts.append("--- Relevant text passages ---")
        for i, txt in enumerate(passage_texts, 1):
            context_parts.append(f"[{i}] {txt}")
    if sentences:
        context_parts.append("--- Knowledge graph facts ---")
        context_parts.extend(sentences)
    context = "\n".join(context_parts) or "(no results)"

    # Step 3: generate answer
    answer_resp = llm.invoke(
        ANSWER_PROMPT.format(context=context, question=effective_question)
    )
    answer = _strip_thinking_blocks(
        answer_resp.content if hasattr(answer_resp, "content") else str(answer_resp)
    )
    answer = re.sub(r"\s*-\[\s*[A-Z_]+\s*\]->\s*", " ", answer)
    answer = re.sub(r"\([^()]*-\[[^()]*\]->[^()]*\)", "", answer)
    answer = re.sub(r"[ \t]+", " ", answer).strip()
    answer = _collapse_repetition(answer)
    answer = answer[:1500]
    reasoning.append({"step": "synthesise_answer", "detail": f"{len(answer)} chars"})

    execution_time = time.perf_counter() - start_time

    # Step 4: semantic scoring
    # Score against individual sentences (max-pooling) rather than the whole
    # context blob — averaging 70+ sentences into one embedding kills signal.
    retrieval_score = 0.0
    confidence_score = 0.0

    if SIMILARITY_MODEL and sentences and answer.strip():
        score_texts = [answer] + sentences
        score_embeddings = SIMILARITY_MODEL.encode(score_texts, convert_to_tensor=True)
        if cached_q_embedding is not None:
            # as_tensor handles both numpy arrays and tensors and moves to the
            # target device. Don't sniff for a `.device` attr to tell them apart:
            # NumPy 2.0+ gives ndarrays a `.device`, which broke the old check.
            q_emb = torch.as_tensor(cached_q_embedding, device=score_embeddings.device)
        else:
            q_emb = SIMILARITY_MODEL.encode(effective_question, convert_to_tensor=True)
        a_emb = score_embeddings[0]
        ctx_embs = score_embeddings[1:]

        q_sims = util.cos_sim(q_emb, ctx_embs)[0]
        a_sims = util.cos_sim(a_emb, ctx_embs)[0]
        retrieval_score = max(0.0, min(1.0, float(q_sims.max())))
        confidence_score = max(0.0, min(1.0, float(a_sims.max()) + 0.1))

    reasoning.append({
        "step": "local_semantic_evaluation",
        "detail": f"retrieval={retrieval_score:.2f}, confidence={confidence_score:.2f}",
    })

    return {
        "answer": answer.strip(),
        "cypher": used_cypher,
        "node_ids": list(node_ids),
        "edge_ids": list(edge_ids),
        "chunk_ids": chunk_ids,
        "context": context,
        "reasoning": reasoning,
        "scores": {"retrieval": round(retrieval_score, 2), "confidence": round(confidence_score, 2)},
        "execution_time": round(execution_time, 2),
    }
