"""Request/response schemas."""
from __future__ import annotations


from typing import Any

from pydantic import BaseModel, Field


class Neo4jCredentials(BaseModel):
    uri: str
    username: str
    password: str


class LLMConfig(BaseModel):
    provider: str = Field(..., description="openai | gemini | nvidia | groq | anthropic")
    model: str
    api_key: str


class EmbeddingConfig(BaseModel):
    provider: str = "sentence-transformers"
    model: str = "BAAI/bge-base-en-v1.5"


class ChunkingConfig(BaseModel):
    chunk_size: int = 670
    chunk_overlap: int = 10


class PipelineRequest(BaseModel):
    sources: list[str] = Field(default_factory=list, description="File paths or URLs to ingest")
    clear_existing: bool = False


class NodeUpdate(BaseModel):
    properties: dict[str, Any] = Field(default_factory=dict)
    new_label: str | None = None


class MergeNodes(BaseModel):
    source_id: str
    target_id: str


class AddRelation(BaseModel):
    source_id: str
    target_id: str
    relation: str
    properties: dict[str, Any] = Field(default_factory=dict)


class RelationUpdate(BaseModel):
    relation: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class ChatTurn(BaseModel):
    question: str
    answer: str


class ChatRequest(BaseModel):
    question: str
    history: list[ChatTurn] = Field(default_factory=list)


class StatusResponse(BaseModel):
    ok: bool
    message: str = ""


class GraphResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]


class SchemaLabel(BaseModel):
    label: str
    count: int


class SchemaRelType(BaseModel):
    type: str
    count: int


class SchemaResponse(BaseModel):
    node_labels: list[SchemaLabel]
    rel_types: list[SchemaRelType]
