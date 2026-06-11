"""Graph CRUD and chat endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.session import state
from app.models.schemas import (
    AddRelation,
    ChatRequest,
    GraphResponse,
    MergeNodes,
    NodeUpdate,
    RelationUpdate,
    SchemaResponse,
    StatusResponse,
)
from app.services.chat_service import graphrag_answer
from app.services.neo4j_service import neo4j_service

router = APIRouter(prefix="/api", tags=["graph"])


def _require_connected():
    if not state.neo4j_connected:
        raise HTTPException(400, "Neo4j not connected.")


@router.get("/graph/schema", response_model=SchemaResponse)
async def get_schema():
    _require_connected()
    return await neo4j_service.get_schema()


@router.get("/graph", response_model=GraphResponse)
async def get_graph(limit: int = 250, layers: str = "entity"):
    _require_connected()
    return await neo4j_service.fetch_graph(limit=limit, layers=layers)


@router.patch("/graph/nodes/{node_id}")
async def update_node(node_id: str, body: NodeUpdate):
    _require_connected()
    return await neo4j_service.update_node(node_id, body.properties, body.new_label)


@router.delete("/graph/nodes/{node_id}", response_model=StatusResponse)
async def delete_node(node_id: str):
    _require_connected()
    await neo4j_service.delete_node(node_id)
    return StatusResponse(ok=True, message=f"Node {node_id} deleted")


@router.post("/graph/nodes/merge", response_model=StatusResponse)
async def merge_nodes(body: MergeNodes):
    _require_connected()
    await neo4j_service.merge_nodes(body.source_id, body.target_id)
    return StatusResponse(ok=True, message="Nodes merged")


@router.post("/graph/relations")
async def add_relation(body: AddRelation):
    _require_connected()
    edge_id = await neo4j_service.add_relation(
        body.source_id, body.target_id, body.relation, body.properties,
    )
    return {"ok": True, "edge_id": edge_id}


@router.patch("/graph/relations/{edge_id}")
async def update_relation(edge_id: str, body: RelationUpdate):
    _require_connected()
    new_id = await neo4j_service.update_relation(edge_id, body.relation, body.properties)
    return {"ok": True, "edge_id": new_id}


@router.delete("/graph/relations/{edge_id}", response_model=StatusResponse)
async def delete_relation(edge_id: str):
    _require_connected()
    await neo4j_service.delete_relation(edge_id)
    return StatusResponse(ok=True, message=f"Relation {edge_id} deleted")


@router.post("/history/{index}/undo")
async def undo_change(index: int):
    _require_connected()
    try:
        message = await neo4j_service.undo_change(index)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "message": message}


@router.get("/history")
async def history(limit: int = 50):
    """Return recent change history (most recent first)."""
    items = state.history[:limit]
    return {
        "items": [
            {
                "timestamp": h.timestamp,
                "action": h.action,
                "target": h.target,
                "before": h.before,
                "after": h.after,
                "user": h.user,
            }
            for h in items
        ]
    }


@router.post("/chat")
async def chat(req: ChatRequest):
    _require_connected()
    if not state.llm_provider:
        raise HTTPException(400, "LLM not configured.")
    history = [{"question": t.question, "answer": t.answer} for t in req.history]
    return await graphrag_answer(req.question, history=history)
