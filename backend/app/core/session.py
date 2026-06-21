"""In-memory session state.

Single-user scaffold: one global session holding the user's Neo4j connection,
chosen LLM, change history, and pipeline progress. Swap for Redis/per-user
sessions when going multi-user.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class ChangeEntry:
    """One human-in-the-loop graph edit."""
    timestamp: str
    action: str          # e.g. "update_node", "delete_node", "add_relation"
    target: str          # node id or "src -> rel -> dst"
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    user: str = "user"


@dataclass
class SessionState:
    # Neo4j connection
    neo4j_uri: str = ""
    neo4j_username: str = ""
    neo4j_password: str = ""
    neo4j_connected: bool = False

    # LLM config
    llm_provider: str = ""        # openai | gemini | nvidia | groq | anthropic | custom
    llm_model: str = ""
    llm_api_key: str = ""
    llm_base_url: str = ""

    # Embedding config
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "BAAI/bge-base-en-v1.5"

    # Chunking
    chunk_size: int = 670
    chunk_overlap: int = 10

    # Vector index availability (set during pipeline startup)
    vector_index_available: bool = False

    # Set by the skip-extraction endpoint to stop extracting more chunks and
    # jump straight to ingestion with whatever triples were gathered so far.
    skip_extraction: bool = False

    # Pipeline progress
    progress: dict[str, Any] = field(default_factory=lambda: {
        "stage": "idle",            # idle | loading | chunking | persisting | extracting | ingesting | done
        "chunks_total": 0,
        "chunks_processed": 0,
        "chunks_failed": 0,
        "chunks_persisted": 0,
        "triples_extracted": 0,
        "triples_ingested": 0,
        "message": "",
    })

    # Change history (most recent first)
    history: list[ChangeEntry] = field(default_factory=list)

    # SSE event queues — one per active subscriber
    event_queues: list[asyncio.Queue] = field(default_factory=list)

    def record_change(self, action: str, target: str, before=None, after=None):
        entry = ChangeEntry(
            timestamp=datetime.utcnow().isoformat() + "Z",
            action=action,
            target=target,
            before=before,
            after=after,
        )
        self.history.insert(0, entry)
        self.history[:] = self.history[:200]   # cap

    async def broadcast(self, event: str, data: dict):
        """Push an event to every active SSE subscriber."""
        for q in list(self.event_queues):
            try:
                q.put_nowait({"event": event, "data": data})
            except asyncio.QueueFull:
                pass


# Module-level singleton
state = SessionState()
