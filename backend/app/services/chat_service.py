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

from sentence_transformers import SentenceTransformer, util

from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service

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
- Every node carries the label :Entity, plus one of: :Person, :Place, :Organization, :Event, :Date, :Work, :Concept, :Object, :Other.
- All nodes have a `name` property (the canonical surface form found in the source text).
- Relationships are directed; type names are UPPER_SNAKE_CASE (e.g. REIGNED_FROM, FATHER_OF, LOCATED_IN).

Rules:
1. Match entities by name with a CASE-INSENSITIVE regex that tolerates spelling variation.
   Use `(?i)` and allow either form for diacritics and romanization variants.
   Marie Curie: match with '(?i).*(marie|curie|skłodowska|sklodowska).*'
   Common name variants: Muhammad/Mehmed/Mohammed, Peter/Pyotr/Pierre,
   Constantinople/Istanbul, Suleiman/Süleyman.
   When unsure, prefer a short stem: `mehm.*iv` over an exact name.

2. For single-subject questions ("tell me about X"), return the 1-hop neighborhood:
   MATCH (n:Entity)-[r]-(m:Entity) WHERE n.name =~ '(?i).*X.*' RETURN n, r, m LIMIT 80

3. For two-subject questions ("how is X related to Y"), use shortestPath with UNWIND outside the path:
   MATCH p = shortestPath((a:Entity)-[*..4]-(b:Entity))
   WHERE a.name =~ '(?i).*X.*' AND b.name =~ '(?i).*Y.*'
   UNWIND relationships(p) AS r
   WITH r, startNode(r) AS n, endNode(r) AS m
   RETURN n, r, m LIMIT 100

4. For questions with 3 or more subjects, use separate MATCH clauses joined by WITH.

5. NEVER nest ANY() inside relationships() or nodes() of a path.
6. NEVER add extra WITH clauses inside a shortestPath MATCH.
7. Always include relationship variables in RETURN so they can be extracted downstream.
   WRONG: RETURN n, m   RIGHT: RETURN n, r, m
8. Always include LIMIT (≤ 100).
9. Output Cypher only — no markdown fences, no comments, no prose.
10. For yes/no questions, superlative questions ("first", "only", "most", "best"), or questions
    asking whether a fact is true about a single subject, use the 1-hop neighborhood (rule 2)
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

You are given a list of facts, one per line, already converted to natural English sentences.

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


def _strip_cypher_fences(text: str) -> str:
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


def _parse_records(records_iter, node_ids: set, edge_ids: set, seen: set, sentences: list) -> None:
    """Extract relationship sentences from Neo4j records into sentences list."""
    for record in records_iter:
        rec_nodes: list = []
        rec_rel = None
        for v in record.values():
            if hasattr(v, "type") and hasattr(v, "start_node"):
                rec_rel = v
                edge_ids.add(v.element_id)
            elif hasattr(v, "labels"):
                rec_nodes.append(v)
                node_ids.add(v.element_id)

        if rec_rel and len(rec_nodes) >= 2:
            s_name = dict(rec_rel.start_node).get("name", "?")
            o_name = dict(rec_rel.end_node).get("name", "?")
            sentence = f"{s_name} {_humanize(rec_rel.type)} {o_name}."
            if sentence not in seen:
                seen.add(sentence)
                sentences.append(sentence)


def _entity_fallback_query(entities: list[str]) -> str:
    """Build a 1-hop neighborhood Cypher from extracted entity names."""
    def _esc(name: str) -> str:
        return name.replace("\\", "\\\\").replace("'", "\\'")

    conditions = " OR ".join(
        f"n.name =~ '(?i).*{_esc(e)}.*' OR m.name =~ '(?i).*{_esc(e)}.*'"
        for e in entities
    )
    return f"MATCH (n:Entity)-[r]-(m:Entity) WHERE {conditions} RETURN n, r, m LIMIT 100"


async def graphrag_answer(question: str, history: list[dict] | None = None) -> dict[str, Any]:
    reasoning: list[dict] = []
    llm = get_llm()
    history_text = _format_history(history)

    # Step 0: rewrite follow-up question into a self-contained one
    effective_question = question
    if history_text:
        rewrite_raw = llm.invoke(
            REWRITE_PROMPT.format(history=history_text, question=question)
        )
        rewritten = (
            rewrite_raw.content if hasattr(rewrite_raw, "content") else str(rewrite_raw)
        ).strip().strip('"').strip("'")
        if rewritten and len(rewritten) < 500:
            effective_question = rewritten
        reasoning.append({"step": "rewrite_question", "detail": effective_question})

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
        }

    reasoning.append({"step": "generate_cypher", "detail": cypher})

    sentences: list[str] = []
    seen_sentences: set[str] = set()
    node_ids: set[str] = set()
    edge_ids: set[str] = set()
    used_cypher = cypher

    # Step 2: execute the LLM-generated Cypher
    try:
        async with neo4j_service.driver.session() as sess:
            result = await sess.run(cypher)
            records = [record async for record in result]

        _parse_records(records, node_ids, edge_ids, seen_sentences, sentences)
        reasoning.append({"step": "execute_cypher", "detail": f"{len(node_ids)} nodes, {len(edge_ids)} edges"})

        # If Cypher ran but returned no relationships, treat it as a failure
        if not sentences:
            raise RuntimeError("Cypher returned no relationship sentences")

    except Exception as e:
        # Step 2b: fallback — extract entities, run fixed 1-hop neighborhood query
        log.warning("Cypher failed or empty (%s) — falling back to entity query.", e)

        entity_raw = llm.invoke(ENTITY_PROMPT.format(question=effective_question))
        entity_text = entity_raw.content if hasattr(entity_raw, "content") else str(entity_raw)
        entities = [line.strip() for line in entity_text.strip().splitlines() if line.strip()][:3]

        # Last resort: use content words from the question
        if not entities:
            entities = [
                w.strip('?,."\'()')
                for w in effective_question.split()
                if len(w.strip('?,."\'()')) > 4
            ][:3]

        fallback_cypher = _entity_fallback_query(entities)
        used_cypher = fallback_cypher
        reasoning.append({"step": "fallback_cypher", "detail": fallback_cypher})

        try:
            async with neo4j_service.driver.session() as sess:
                result = await sess.run(fallback_cypher)
                records = [record async for record in result]

            _parse_records(records, node_ids, edge_ids, seen_sentences, sentences)
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
            }

    context = "\n".join(sentences) or "(no results)"

    # Step 3: generate answer
    answer_resp = llm.invoke(
        ANSWER_PROMPT.format(context=context, question=effective_question)
    )
    answer = answer_resp.content if hasattr(answer_resp, "content") else str(answer_resp)
    answer = re.sub(r"\s*-\[\s*[A-Z_]+\s*\]->\s*", " ", answer)
    answer = re.sub(r"\([^()]*-\[[^()]*\]->[^()]*\)", "", answer)
    answer = re.sub(r"[ \t]+", " ", answer).strip()
    answer = _collapse_repetition(answer)
    answer = answer[:1500]
    reasoning.append({"step": "synthesise_answer", "detail": f"{len(answer)} chars"})

    # Step 4: semantic scoring
    # Score against individual sentences (max-pooling) rather than the whole
    # context blob — averaging 70+ sentences into one embedding kills signal.
    retrieval_score = 0.0
    confidence_score = 0.0

    if SIMILARITY_MODEL and sentences and answer.strip():
        all_texts = [effective_question, answer] + sentences
        embeddings = SIMILARITY_MODEL.encode(all_texts, convert_to_tensor=True)
        q_emb = embeddings[0]
        a_emb = embeddings[1]
        ctx_embs = embeddings[2:]

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
        "context": context,
        "reasoning": reasoning,
        "scores": {"retrieval": round(retrieval_score, 2), "confidence": round(confidence_score, 2)},
    }
