"""GraphRAG chat service.

Given a user question:
1. Ask the LLM to generate a Cypher query (text-to-Cypher).
2. Execute the Cypher and collect entities + relationships used.
3. Format the retrieved subgraph as text context.
4. Ask the LLM to produce a final natural-language answer.
5. Return answer + cypher + retrieved node/edge ids + reasoning steps.

The frontend uses node_ids / edge_ids to highlight the graph in green.
"""
from __future__ import annotations

import re
from typing import Any

from app.services.llm_service import get_llm
from app.services.neo4j_service import neo4j_service

CYPHER_PROMPT = """You are a Neo4j Cypher expert.
The graph schema is:
- Nodes: (:Entity {{name: STRING}})
- Relationships: directed, type names in UPPER_SNAKE_CASE

Write ONE read-only Cypher query that retrieves the entities and relationships
needed to answer the question. Rules:
- Match relevant Entity nodes by name (use CONTAINS or =~ regex, case-insensitive).
- Return n, r, m so we can identify nodes and edges.
- LIMIT 25.
- No comments, no markdown — Cypher only.

Question: {question}
Cypher:"""

ANSWER_PROMPT = """You are answering using a knowledge graph.
The context lists entities and their relationships as triples.

Rules:
- Use ONLY the context to answer.
- Cite the entities involved.
- If the context is empty, say so plainly.
- Be concise (2-4 sentences).

Context:
{context}

Question: {question}

Answer:"""


def _strip_cypher_fences(text: str) -> str:
    text = re.sub(r"^```(?:cypher)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    # Often the model adds preamble — grab the first MATCH... onward
    m = re.search(r"(MATCH|CALL|WITH|OPTIONAL MATCH)\b.*", text, re.IGNORECASE | re.DOTALL)
    return (m.group(0) if m else text).strip().rstrip(";")


async def graphrag_answer(question: str) -> dict[str, Any]:
    reasoning: list[dict] = []
    llm = get_llm()

    # Step 1: generate Cypher
    cypher_raw = llm.invoke(CYPHER_PROMPT.format(question=question))
    cypher = _strip_cypher_fences(
        cypher_raw.content if hasattr(cypher_raw, "content") else str(cypher_raw)
    )
    reasoning.append({"step": "generate_cypher", "detail": cypher})

    # Step 2: execute (read-only guard)
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
        triples_context: list[str] = []
        node_ids: set[str] = set()
        edge_ids: set[str] = set()

        async with neo4j_service.driver.session() as sess:
            result = await sess.run(cypher)
            async for record in result:
                values = list(record.values())
                # Pull out nodes and relationships from arbitrary RETURN shape
                line_parts = []
                for v in values:
                    if hasattr(v, "labels"):                       # node
                        node_ids.add(v.element_id)
                        line_parts.append(dict(v).get("name", "node"))
                    elif hasattr(v, "type") and hasattr(v, "start_node"):  # relationship
                        edge_ids.add(v.element_id)
                        line_parts.append(f"-[{v.type}]->")
                if line_parts:
                    triples_context.append(" ".join(line_parts))

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

    context = "\n".join(triples_context) or "(no results)"

    # Step 3: final answer
    answer_resp = llm.invoke(ANSWER_PROMPT.format(context=context, question=question))
    answer = answer_resp.content if hasattr(answer_resp, "content") else str(answer_resp)
    reasoning.append({"step": "synthesise_answer", "detail": f"{len(answer)} chars"})

    # Crude scoring — purely indicative, not a benchmark
    retrieval_score = min(1.0, (len(node_ids) + len(edge_ids)) / 10)
    confidence = 0.0 if "no results" in context else min(1.0, 0.4 + retrieval_score * 0.6)

    return {
        "answer": answer.strip(),
        "cypher": cypher,
        "node_ids": list(node_ids),
        "edge_ids": list(edge_ids),
        "context": context,
        "reasoning": reasoning,
        "scores": {"retrieval": round(retrieval_score, 2), "confidence": round(confidence, 2)},
    }
