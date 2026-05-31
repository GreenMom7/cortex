#!/usr/bin/env bash
# Run the Cortex FastAPI backend.
set -e
cd "$(dirname "$0")"
uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}" --reload --reload-dir app
