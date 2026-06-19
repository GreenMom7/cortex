# Cortex — Interactive GraphRAG 

Cortex is a web application that helps to understand the general framework of GraphRAG. GraphRAG in general helps to reduce LLM hallucination when giving the users answer. LLM is connected to an external knowledge base which serves for it to retrieve solid, genuine information on any specific-domain knowledge. 

Built for UTBM DS50 project : *Interactive GraphRAG: Human-in-the-Loop Knowledge Engineering with LangChain and Neo4j*.

---

## Stack

**Backend** — FastAPI + async Neo4j driver + SSE (`sse-starlette`) for progress streaming

**Frontend** — Next.js 15 (App Router) + React 19 + Tailwind + [react-force-graph](https://github.com/vasturiano/react-force-graph) (canvas, live d3-force) + Sonner for toasts

**LLM providers** — OpenAI · Gemini · Anthropic · NVIDIA · Groq (the user picks at runtime — no recompile)

**Embeddings** — HuggingFace sentence-transformers, NVIDIA, or OpenAI

**Graph database** — Neo4j AuraDB (or self-hosted)

---

## Getting started

### Prerequisites

- Python ≥ 3.10
- Node.js ≥ 18
- A running Neo4j (the easiest path: a free [Neo4j AuraDB](https://neo4j.com/cloud/aura/) instance)
- API key for at least one LLM provider

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # try python3 if failed
pip install -r requirements.txt    # try pip3 if failed
cp .env.example .env             # optional — defaults can be entered via the UI
./run.sh                          # http://localhost:8000
```

OpenAPI docs at `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                       # http://localhost:3000
```

### 3. First-run checklist

In the left sidebar, top to bottom:

1. **LLM** — pick a provider, pick a model, paste the API key, click *Save & test*. Wait for the green "Live" chip.
2. **Neo4j** — paste your URI / username / password, click *Connect*. Wait for "Connected".
3. **Chunking** — leave defaults unless you know better. `670` / `10` matches the GraphRAG notebook.
4. **Sources** — drop a PDF / JSON / CSV, or paste a URL (web page or Wikipedia article). Tick *clear graph before ingest* if this is a fresh run.
5. Click **Run pipeline**. Watch the **Progress** card fill up.
6. When the stage shows `done`, the graph should appear in the center pane. Click any node to inspect or edit it.
7. Switch the right pane to **Chat** and ask a question. The Cypher and reasoning are collapsible. Nodes the LLM actually retrieved light up green on the graph.

---

## API surface

All under `/api`.

### Config

```
GET    /api/config/providers       List supported provider→model catalog
POST   /api/config/neo4j           { uri, username, password }     test + persist
GET    /api/config/neo4j/status    { ok, message }
POST   /api/config/llm             { provider, model, api_key }    test + persist
POST   /api/config/embeddings      { provider, model }
POST   /api/config/chunking        { chunk_size, chunk_overlap }
GET    /api/config/status          current session config snapshot
```

### Pipeline

```
POST   /api/pipeline/upload        multipart files          → list of server paths
POST   /api/pipeline/run           { sources, clear_existing }
GET    /api/pipeline/progress      Server-Sent Events  (event: progress)
```

The `/progress` stream emits one event on connect and every time a stage changes
or a chunk batch is processed. Payload:

```json
{
  "stage": "extracting",
  "chunks_total": 142,
  "chunks_processed": 87,
  "triples_extracted": 318,
  "triples_ingested": 250,
  "message": "Extracted 318 triples from 87/142 chunks"
}
```

### Graph

```
GET    /api/graph?limit=250        { nodes, edges }
PATCH  /api/graph/nodes/{id}       { properties, new_label }
DELETE /api/graph/nodes/{id}
POST   /api/graph/nodes/merge      { source_id, target_id }
POST   /api/graph/relations        { source_id, target_id, relation, properties }
DELETE /api/graph/relations/{id}
GET    /api/history?limit=50       Most recent change log entries
```

### Chat

```
POST   /api/chat                   { question }
```

Response shape:

```json
{
  "answer": "…natural language answer…",
  "cypher": "MATCH (n)-[r]->(m) WHERE n.name CONTAINS 'Amazon' RETURN n, r, m LIMIT 25",
  "node_ids": ["4:abc:1", "4:abc:7"],
  "edge_ids": ["5:abc:0"],
  "context": "Amazon -[ACCUSED_OF]-> Inflating prices …",
  "reasoning": [
    { "step": "generate_cypher",    "detail": "MATCH …" },
    { "step": "execute_cypher",     "detail": "3 nodes, 4 edges" },
    { "step": "synthesise_answer",  "detail": "212 chars" }
  ],
  "scores": { "retrieval": 0.7, "confidence": 0.82 }
}
```

`node_ids` / `edge_ids` are the keys the frontend uses to glow nodes green.

---

## How the pieces talk

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Next.js)                                                │
│                                                                    │
│   GraphView ←──── /api/graph ───────┐                             │
│                                       │                             │
│   ChatPanel ─────  /api/chat ────────┤                             │
│        │                              │                             │
│        └─ highlight ids ──► GraphView│                             │
│                                       │                             │
│   Sidebar ────── /api/config/* ──────┤                             │
│              ── /api/pipeline/* ────┤                             │
│                                       │                             │
│   ProgressCard  ◄── SSE  ←─ /api/pipeline/progress                │
└───────────────────────────────────────┼─────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI                                                          │
│                                                                    │
│  Neo4jService ◄──► AsyncDriver ◄──► Neo4j (Aura)                  │
│  LLMService   ◄──► OpenAI / Gemini / Anthropic / NVIDIA / Groq    │
│  Orchestrator: loaders → splitter → extractor → ingest            │
│  ChatService:  question → Cypher → execute → synthesise           │
│  SessionState: in-memory; broadcasts progress to SSE subscribers  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Human-in-the-loop, explained

Every mutation to the graph (node update, delete, merge, add-relation, delete-relation) goes through `Neo4jService` which records a `ChangeEntry` in `SessionState.history` with timestamp, action, target and a snapshot of before/after. The `HistoryPanel` reads that list. The list is capped at the last 200 entries — extend or persist to disk if you need a longer audit trail.

Practical workflow:

1. The pipeline produces a graph that's roughly right but has noise — duplicate entities, weak relations, hallucinated edges.
2. You filter the graph mentally as you scroll; click a suspicious node.
3. Fix the name. Change its label from `Entity` to `Company`. Add a property `confidence: high`.
4. Click *Save changes*. The history tab gets a new entry. The graph re-fetches.
5. If the same concept appears as two nodes (`Amazon` and `Amazon Inc.`), pick one, hit *Merge*, enter the other node's id. All relationships rebind to the survivor.
6. Re-ask the chatbot. The answer should now ground on the cleaner graph.

---


## License

MIT — Akmal
