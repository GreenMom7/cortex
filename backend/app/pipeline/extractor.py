"""Triple extraction — text chunk -> [(subject, relation, object)]."""
from __future__ import annotations

import json
import re

EXTRACTION_PROMPT = """You are an expert Knowledge Graph Engineer.
Extract only the most essential and high-confidence factual relationships from the text below.

Strict Rules:
1. Format: {{"subject": "...", "relation": "...", "object": "..."}}
2. Subject/Object: Must be specific entities or concepts (nouns). No pronouns or long sentences.
3. Relation: Strict UPPERCASE_WITH_UNDERSCORES representing the action (e.g., PLAYS_FOR, WON_AGAINST, LOCATED_IN).
4. Quality: Avoid weak relations like HAS_TITLE or IS_TEXT. Focus on meaningful events, roles, facts.
5. Cleanliness: No emojis, special characters, or unnecessary punctuation.
6. Output: Return ONLY a valid JSON list, nothing else.

Text:
{text}

JSON list of triples:"""


def parse_triples(raw: str) -> list[dict]:
    """Robustly extract a JSON list of triples from an LLM response."""
    # Strip markdown fences
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    # Find the first [ ... ]
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        return []
    try:
        triples = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for t in triples:
        if not isinstance(t, dict):
            continue
        s = str(t.get("subject", "")).strip()
        r = str(t.get("relation", "")).strip().upper().replace(" ", "_")
        o = str(t.get("object", "")).strip()
        if s and r and o:
            out.append({"subject": s, "relation": r, "object": o})
    return out


def extract_from_chunk(chunk_text: str, llm) -> list[dict]:
    """Call the LLM once on one chunk; return parsed triples."""
    prompt = EXTRACTION_PROMPT.format(text=chunk_text)
    resp = llm.invoke(prompt)
    raw = resp.content if hasattr(resp, "content") else str(resp)
    return parse_triples(raw)
