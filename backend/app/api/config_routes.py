"""Configuration endpoints: Neo4j connection, LLM choice, embedding choice."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.session import state
from app.models.schemas import (
    ChunkingConfig,
    EmbeddingConfig,
    LLMConfig,
    Neo4jCredentials,
    StatusResponse,
)
from app.services.llm_service import MODEL_CATALOG, get_llm
from app.services.neo4j_service import neo4j_service

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/providers")
async def list_providers():
    """Return the LLM provider/model catalog for the UI dropdowns."""
    return {"providers": MODEL_CATALOG}


@router.post("/neo4j", response_model=StatusResponse)
async def connect_neo4j(creds: Neo4jCredentials):
    result = await neo4j_service.connect(creds.uri, creds.username, creds.password)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return StatusResponse(**result)


@router.get("/neo4j/status", response_model=StatusResponse)
async def neo4j_status():
    return StatusResponse(
        ok=state.neo4j_connected,
        message="Connected" if state.neo4j_connected else "Not connected",
    )


@router.post("/llm", response_model=StatusResponse)
async def set_llm(cfg: LLMConfig):
    state.llm_provider = cfg.provider.lower()
    state.llm_model = cfg.model
    state.llm_api_key = cfg.api_key
    state.llm_base_url = cfg.base_url or ""
    # Smoke test
    try:
        llm = get_llm()
        resp = llm.invoke("Reply with the word OK.")
        text = resp.content if hasattr(resp, "content") else str(resp)
        return StatusResponse(ok=True, message=f"LLM responded: {text.strip()[:80]}")
    except Exception as e:
        state.llm_provider = ""
        state.llm_model = ""
        state.llm_base_url = ""
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/embeddings", response_model=StatusResponse)
async def set_embeddings(cfg: EmbeddingConfig):
    state.embedding_provider = cfg.provider
    state.embedding_model = cfg.model
    return StatusResponse(ok=True, message=f"Embeddings set to {cfg.provider}/{cfg.model}")


@router.post("/chunking", response_model=StatusResponse)
async def set_chunking(cfg: ChunkingConfig):
    if cfg.chunk_size <= 0 or cfg.chunk_overlap < 0 or cfg.chunk_overlap >= cfg.chunk_size:
        raise HTTPException(status_code=400, detail="Invalid chunk size / overlap")
    state.chunk_size = cfg.chunk_size
    state.chunk_overlap = cfg.chunk_overlap
    return StatusResponse(ok=True, message=f"Chunk size={cfg.chunk_size}, overlap={cfg.chunk_overlap}")


@router.get("/status")
async def status():
    return {
        "neo4j_connected": state.neo4j_connected,
        "llm_provider": state.llm_provider,
        "llm_model": state.llm_model,
        "embedding_provider": state.embedding_provider,
        "embedding_model": state.embedding_model,
        "chunk_size": state.chunk_size,
        "chunk_overlap": state.chunk_overlap,
    }
