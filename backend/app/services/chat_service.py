"""GraphRAG chat service.

Given a user question:
1. Ask the LLM to generate a Cypher query (text-to-Cypher).
2. Execute the Cypher and collect entities + relationships used.
3. Format the retrieved subgraph as natural-sentence context.
4. Ask the LLM to produce a final natural-language answer.
5. Return answer + cypher + retrieved node/edge ids + reasoning steps.

The frontend uses node_ids / edge_ids to highlight the graph in green.
"""
from __future__ import annotations

import re
import logging
from typing import Any

# New imports for local semantic scoring
from sentence_transformers import SentenceTransformer, util

from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Local Semantic Scorer Initialization
# ---------------------------------------------------------------------------
# We use the same model your system uses as a zero-cost fallback. 
# Loaded once globally to prevent latency on every request.
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
   Common name variants: Muhammad/Mehmed/Mohammed, Peter/Pyotr/Pierre,
   Constantinople/Istanbul, Suleiman/Süleyman.
   When unsure, prefer a short stem: `mehm.*iv` over an exact name.

2. For single-subject questions ("tell me about X"), return the 1-hop neighborhood:
   MATCH (n:Entity)-[r]-(m:Entity) WHERE n.name =~ '(?i).*X.*' RETURN n, r, m LIMIT 80

3. For two-subject questions ("how is X related to Y" or questions mentioning two entities),
   use shortestPath with UNWIND OUTSIDE the path:
   MATCH p = shortestPath((a:Entity)-[*..4]-(b:Entity))
   WHERE a.name =~ '(?i).*X.*' AND b.name =~ '(?i).*Y.*'
   UNWIND relationships(p) AS r
   WITH r, startNode(r) AS n, endNode(r) AS m
   RETURN n, r, m LIMIT 100

4. For questions with 3 or more subjects, use separate MATCH clauses joined by WITH:
   MATCH (a:Entity)-[r1]-(b:Entity)
   WHERE a.name =~ '(?i).*X.*' AND b.name =~ '(?i).*Y.*'
   WITH a, r1, b
   MATCH (c:Entity)-[r2]-(d:Entity)
   WHERE c.name =~ '(?i).*Z.*'
   RETURN a, r1, b, c, r2, d LIMIT 100

5. NEVER nest ANY() inside relationships() or nodes() of a path.
6. NEVER add extra WITH clauses inside a shortestPath MATCH.
7. Always return node and relationship variables so they can be extracted downstream.
8. Always include LIMIT (≤ 100).
9. Output Cypher only — no markdown fences, no comments, no prose.

Question: {question}
Cypher:"""


ANSWER_PROMPT = """You are a research assistant answering a question using a knowledge graph extracted from documents.

You are given a list of facts, one per line, already converted to natural English sentences.

Hard rules for your answer:
1. Write natural prose — like a Wikipedia summary or a knowledgeable friend. NEVER use triple notation like `Subject -[RELATION]-> Object` or `(Subject, RELATION, Object)`. NEVER include UPPER_SNAKE_CASE relation names, arrows (`->`, `-[...]->`), or parenthetical citations of the source triples. Just write sentences.
2. Be thorough. Cover every fact in the context that is relevant to the question. For a "tell me about X" question, write a full paragraph of 4-8 sentences minimum. Do not stop at the first 2-3 facts.
3. The graph is the authoritative source for specific facts (names, dates, places, roles, kinships, events). You MAY use general knowledge from your training to add brief connective context that helps the prose flow (e.g. clarifying what an "Ottoman Empire" is in a clause), but do NOT introduce new specific facts (new dates, new names, new relationships) that aren't in the context. If you blend in background knowledge, keep it brief and clearly subordinate to the graph facts.
4. Names may differ between question and context due to transliteration (e.g. user asks "Muhammad IV", context calls him "Mehmed IV"; "Suleyman" vs "Süleyman"; "Constantinople" vs "Istanbul"). Treat them as the same entity and answer normally.
5. If the context is empty or doesn't address the question, say so plainly in one sentence.
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
    """REIGNED_FROM -> 'reigned from'. WAS_NICKNAMED -> 'was nicknamed'."""
    return rel.replace("_", " ").lower().strip()


def _collapse_repetition(text: str, min_phrase_words: int = 4, max_repeats: int = 2) -> str:
    """Detect and truncate degenerate-loop output.

    LLMs (especially open-weight models at low temperature without a token cap)
    occasionally fall into a "..., but also X, but also X, but also X..." loop.
    If we see the same chunk repeated more than `max_repeats` times in a row
    after splitting on a connective, cut the text at the start of the second
    repeat and add an ellipsis.
    """
    # Split on commas and connective phrases that commonly mark repetition
    parts = re.split(r"(?:,| but| and| also| or)\s+", text)
    if len(parts) < max_repeats + 2:
        return text

    # Sliding check: same N-word chunk repeating
    norm = [p.strip().lower() for p in parts]
    for i in range(len(norm) - max_repeats):
        head = norm[i]
        if len(head.split()) < min_phrase_words:
            continue
        if all(norm[i + k] == head for k in range(1, max_repeats + 1)):
            # Repetition detected starting at index i+1; cut just before it
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
            # Keep history compact — cap answer length so prompts stay small
            if len(a) > 400:
                a = a[:400] + "…"
            lines.append(f"Assistant: {a}")
    return "\n".join(lines)


async def graphrag_answer(question: str, history: list[dict] | None = None) -> dict[str, Any]:
    reasoning: list[dict] = []
    llm = get_llm()
    history_text = _format_history(history)

    # Step 0: rewrite follow-up question into a self-contained one.
    # Skip when there's no history or the question is already long & looks complete.
    effective_question = question
    if history_text:
        rewrite_raw = llm.invoke(
            REWRITE_PROMPT.format(history=history_text, question=question)
        )
        rewritten = (
            rewrite_raw.content if hasattr(rewrite_raw, "content") else str(rewrite_raw)
        ).strip().strip('"').strip("'")
        # Defensive: if rewrite produced something empty/silly, fall back to original
        if rewritten and len(rewritten) < 500:
            effective_question = rewritten
        reasoning.append({"step": "rewrite_question", "detail": effective_question})

    # Step 1: generate Cypher
    cypher_raw = llm.invoke(CYPHER_PROMPT.format(question=effective_question))
    cypher = _strip_cypher_fences(
        cypher_raw.content if hasattr(cypher_raw, "content") else str(cypher_raw)
    )
    reasoning.append({"step": "generate_cypher", "detail": cypher})

    # Step 2: write-op guard
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

    try:
        sentences: list[str] = []
        seen_sentences: set[str] = set()
        seen_solo_nodes: set[str] = set()
        node_ids: set[str] = set()
        edge_ids: set[str] = set()

        async with neo4j_service.driver.session() as sess:
            result = await sess.run(cypher)
            async for record in result:
                # Pull nodes + relationships out of the record regardless of column order
                rec_nodes: list = []
                rec_rel = None
                for v in record.values():
                    if hasattr(v, "type") and hasattr(v, "start_node"):  # Relationship
                        rec_rel = v
                        edge_ids.add(v.element_id)
                    elif hasattr(v, "labels"):  # Node
                        rec_nodes.append(v)
                        node_ids.add(v.element_id)

                if rec_rel and len(rec_nodes) >= 2:
                    # Use the relationship's start/end to get correct direction
                    s_node = rec_rel.start_node
                    o_node = rec_rel.end_node
                    s_name = dict(s_node).get("name", "?")
                    o_name = dict(o_node).get("name", "?")
                    sentence = f"{s_name} {_humanize(rec_rel.type)} {o_name}."
                    if sentence not in seen_sentences:
                        seen_sentences.add(sentence)
                        sentences.append(sentence)
                else:
                    # Standalone node — record its name so the LLM at least knows it was matched
                    for n in rec_nodes:
                        name = dict(n).get("name")
                        if name and name not in seen_solo_nodes:
                            seen_solo_nodes.add(name)
                            sentences.append(f"{name} is in the graph.")

        reasoning.append({"step": "execute_cypher", "detail": f"{len(node_ids)} nodes, {len(edge_ids)} edges"})
    except Exception as e:
        return {
            "answer": f"Cypher execution failed: {e}",
            "cypher": cypher,
            "node_ids": [],
            "edge_ids": [],
            "context": "",
            "reasoning": reasoning + [{"step": "error", "detail": str(e)}],
            "scores": {"retrieval": 0.0, "confidence": 0.0},
        }

    context = "\n".join(sentences) or "(no results)"

    # Step 3: final answer — use the rewritten question so the answer addresses
    # what the user actually meant, not the elliptical surface form.
    answer_resp = llm.invoke(
        ANSWER_PROMPT.format(context=context, question=effective_question)
    )
    answer = answer_resp.content if hasattr(answer_resp, "content") else str(answer_resp)
    # Belt-and-braces: scrub any triple notation the LLM still emitted
    answer = re.sub(r"\s*-\[\s*[A-Z_]+\s*\]->\s*", " ", answer)
    answer = re.sub(r"\([^()]*-\[[^()]*\]->[^()]*\)", "", answer)
    answer = re.sub(r"[ \t]+", " ", answer).strip()
    # Anti-loop guard: cut runaway repetition
    answer = _collapse_repetition(answer)
    reasoning.append({"step": "synthesise_answer", "detail": f"{len(answer)} chars"})

    # ---------------------------------------------------------------------------
    # Step 4: Semantic Local Scoring (BERTScore-style)
    # ---------------------------------------------------------------------------
    retrieval_score = 0.0
    confidence_score = 0.0

    if SIMILARITY_MODEL and "no results" not in context.lower() and answer.strip():
        # Compute embeddings for Question, Answer, and Context
        # Retrieval Score: Semantic similarity between Question and Context
        # Confidence Score: Semantic similarity between Context and Answer
        embeddings = SIMILARITY_MODEL.encode([effective_question, answer, context], convert_to_tensor=True)
        
        # Calculate Cosine Similarity (normalized to 0.0 - 1.0)
        q_sim = util.cos_sim(embeddings[0], embeddings[2]).item()
        a_sim = util.cos_sim(embeddings[1], embeddings[2]).item()
        
        retrieval_score = max(0.0, min(1.0, q_sim))
        # We add a small baseline for confidence because answers contain natural
        # connective language that isn't in the raw context facts.
        confidence_score = max(0.0, min(1.0, a_sim + 0.1))

    reasoning.append({
        "step": "local_semantic_evaluation", 
        "detail": f"retrieval={retrieval_score:.2f}, confidence={confidence_score:.2f}"
    })

    return {
        "answer": answer.strip(),
        "cypher": cypher,
        "node_ids": list(node_ids),
        "edge_ids": list(edge_ids),
        "context": context,
        "reasoning": reasoning,
        "scores": {"retrieval": round(retrieval_score, 2), "confidence": round(confidence_score, 2)},
    }
