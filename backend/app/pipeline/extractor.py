"""Triple extraction — text chunk -> [{subject, subject_type, relation, object, object_type}]."""
from __future__ import annotations

import json
import re

# Allowed entity classes. Keep this list short and stable — the LLM tends to
# invent new types if you give it free rein, which fragments the graph.
ENTITY_TYPES = [
    "Person",
    "Place",
    "Organization",
    "Event",
    "Date",
    "Work",       # books, treaties, laws, artworks
    "Concept",    # abstract things: religions, ideologies, fields
    "Object",     # physical artifacts
    "Other",
]

EXTRACTION_PROMPT = """You are an expert Knowledge Graph Engineer.
Extract only the most essential and high-confidence factual relationships from the text below.

Strict Rules:
1. Format: {{"subject": "...", "subject_type": "...", "relation": "...", "object": "...", "object_type": "..."}}
2. Subject/Object: Specific entities or concepts (nouns). No pronouns or long sentences.
3. subject_type / object_type MUST be one of: {types}. Pick the single best fit; use "Other" only as a last resort.
4. Relation: Strict UPPERCASE_WITH_UNDERSCORES representing the action (e.g., PLAYS_FOR, WON_AGAINST, LOCATED_IN).
5. Quality: Avoid weak relations like HAS_TITLE or IS_TEXT. Focus on meaningful events, roles, facts.
6. Cleanliness: No emojis, special characters, or unnecessary punctuation.
7. Output: Return ONLY a valid JSON list, nothing else.

Text:
{text}

JSON list of triples:"""


_LABEL_RE = re.compile(r"[^A-Za-z0-9_]")


def sanitize_label(label: str) -> str:
    """Make a string safe to use as a Neo4j node label (alphanumeric + underscore)."""
    cleaned = _LABEL_RE.sub("", (label or "").strip())
    if not cleaned:
        return "Entity"
    # Neo4j labels can't start with a digit
    if cleaned[0].isdigit():
        cleaned = "_" + cleaned
    return cleaned


def parse_triples(raw: str, allowed_types: list[str] | None = None) -> list[dict]:
    """Robustly extract a JSON list of triples from an LLM response."""
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        return []
    try:
        triples = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []

    allowed = set(allowed_types or ENTITY_TYPES)
    out = []
    for t in triples:
        if not isinstance(t, dict):
            continue
        s = str(t.get("subject", "")).strip()
        r = str(t.get("relation", "")).strip().upper().replace(" ", "_")
        o = str(t.get("object", "")).strip()
        s_type = str(t.get("subject_type", "")).strip().capitalize()
        o_type = str(t.get("object_type", "")).strip().capitalize()
        if s_type not in allowed:
            s_type = "Other"
        if o_type not in allowed:
            o_type = "Other"
        if s and r and o:
            out.append({
                "subject": s,
                "subject_type": s_type,
                "relation": r,
                "object": o,
                "object_type": o_type,
            })
    return out


def extract_from_chunk(chunk_text: str, llm, entity_types: list[str] | None = None) -> list[dict]:
    """Call the LLM once on one chunk; return parsed triples."""
    types = entity_types or ENTITY_TYPES
    prompt = EXTRACTION_PROMPT.format(text=chunk_text, types=", ".join(types))
    resp = llm.invoke(prompt)
    raw = resp.content if hasattr(resp, "content") else str(resp)
    return parse_triples(raw, allowed_types=types)
