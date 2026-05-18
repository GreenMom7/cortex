"""Pipeline endpoints: file upload, run pipeline, progress (SSE)."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.core.session import state
from app.models.schemas import PipelineRequest
from app.pipeline.orchestrator import run_pipeline

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

UPLOAD_DIR = Path(settings.UPLOAD_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    """Save uploaded files to disk; return their server-side paths."""
    saved = []
    for f in files:
        size_mb = 0
        dest = UPLOAD_DIR / f.filename
        with dest.open("wb") as out:
            while chunk := await f.read(1024 * 1024):
                out.write(chunk)
                size_mb += len(chunk) / (1024 * 1024)
                if size_mb > settings.MAX_UPLOAD_MB:
                    dest.unlink(missing_ok=True)
                    raise HTTPException(413, f"{f.filename} exceeds {settings.MAX_UPLOAD_MB} MB")
        saved.append({
            "name": f.filename,
            "path": str(dest),
            "size_bytes": dest.stat().st_size,
        })
    return {"ok": True, "files": saved}


_background_tasks: set[asyncio.Task] = set()


@router.post("/run")
async def run(req: PipelineRequest, background: BackgroundTasks):
    if not state.neo4j_connected:
        raise HTTPException(400, "Neo4j not connected.")
    if not state.llm_provider:
        raise HTTPException(400, "LLM not configured.")
    if not req.sources:
        raise HTTPException(400, "No sources provided.")

    async def _runner():
        import traceback
        print(f"[pipeline] starting: {len(req.sources)} source(s), clear={req.clear_existing}", flush=True)
        try:
            result = await run_pipeline(req.sources, clear_existing=req.clear_existing)
            print(f"[pipeline] finished: {result}", flush=True)
        except Exception as e:
            print(f"\n[pipeline] FAILED: {e}\n{traceback.format_exc()}", flush=True)
            state.progress["stage"] = "idle"
            state.progress["message"] = f"Pipeline failed: {e}"
            await state.broadcast("progress", dict(state.progress))
            await state.broadcast("error", {"message": str(e)})

    task = asyncio.create_task(_runner())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"ok": True, "message": "Pipeline started; subscribe to /api/pipeline/progress for updates"}


@router.get("/progress/snapshot")
async def progress_snapshot():
    """One-shot snapshot of current pipeline progress (polling fallback for SSE)."""
    return state.progress


@router.get("/progress")
async def progress_stream():
    """SSE stream of pipeline progress events.

    Emits a snapshot on connect, then every state.broadcast() call.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    state.event_queues.append(queue)

    async def gen():
        # Initial snapshot
        yield {"event": "progress", "data": _json_dumps(state.progress)}
        try:
            while True:
                evt = await queue.get()
                yield {"event": evt["event"], "data": _json_dumps(evt["data"])}
        except asyncio.CancelledError:
            pass
        finally:
            if queue in state.event_queues:
                state.event_queues.remove(queue)

    return EventSourceResponse(gen())


def _json_dumps(obj):
    import json
    return json.dumps(obj, default=str)
