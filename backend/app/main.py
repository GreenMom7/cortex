"""FastAPI entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import config_routes, graph_routes, pipeline_routes
from app.core.config import settings
from app.services.neo4j_service import neo4j_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-connect Neo4j on startup if env credentials are set
    if settings.NEO4J_URI and settings.NEO4J_PASSWORD:
        await neo4j_service.connect(
            settings.NEO4J_URI, settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD,
        )
    yield
    await neo4j_service.disconnect()


app = FastAPI(
    title="Cortex — Interactive GraphRAG",
    description="Human-in-the-loop knowledge graph engineering.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config_routes.router)
app.include_router(pipeline_routes.router)
app.include_router(graph_routes.router)


@app.get("/")
async def root():
    return {"name": "Cortex API", "version": "0.1.0", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"ok": True}
