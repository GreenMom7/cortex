// Tiny typed fetch wrapper around the FastAPI backend.
const API = process.env.NEXT_PUBLIC_API_URL || "";

async function call<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

export const api = {
  // Config
  listProviders: () => call<{ providers: Record<string, string[]> }>("/api/config/providers"),
  connectNeo4j: (uri: string, username: string, password: string) =>
    call<{ ok: boolean; message: string }>("/api/config/neo4j", {
      method: "POST",
      body: JSON.stringify({ uri, username, password }),
    }),
  neo4jStatus: () => call<{ ok: boolean; message: string }>("/api/config/neo4j/status"),
  getStatus: () => call<{
    neo4j_connected: boolean;
    llm_provider: string;
    llm_model: string;
    embedding_provider: string;
    embedding_model: string;
    chunk_size: number;
    chunk_overlap: number;
  }>("/api/config/status"),
  getProgress: () => call<{
    stage: "idle" | "loading" | "chunking" | "extracting" | "ingesting" | "done";
    chunks_total: number;
    chunks_processed: number;
    triples_extracted: number;
    triples_ingested: number;
    message: string;
  }>("/api/pipeline/progress/snapshot"),
  setLLM: (provider: string, model: string, api_key: string) =>
    call<{ ok: boolean; message: string }>("/api/config/llm", {
      method: "POST",
      body: JSON.stringify({ provider, model, api_key }),
    }),
  setEmbeddings: (provider: string, model: string) =>
    call("/api/config/embeddings", {
      method: "POST",
      body: JSON.stringify({ provider, model }),
    }),
  setChunking: (chunk_size: number, chunk_overlap: number) =>
    call("/api/config/chunking", {
      method: "POST",
      body: JSON.stringify({ chunk_size, chunk_overlap }),
    }),

  // Pipeline
  uploadFiles: async (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const res = await fetch(`${API}/api/pipeline/upload`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ ok: boolean; files: { name: string; path: string; size_bytes: number }[] }>;
  },
  runPipeline: (sources: string[], clear_existing = false) =>
    call("/api/pipeline/run", {
      method: "POST",
      body: JSON.stringify({ sources, clear_existing }),
    }),

  // Graph
  getGraph: (limit = 250) =>
    call<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/graph?limit=${limit}`),
  updateNode: (id: string, properties: Record<string, any>, new_label?: string) =>
    call(`/api/graph/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties, new_label }),
    }),
  deleteNode: (id: string) =>
    call(`/api/graph/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mergeNodes: (source_id: string, target_id: string) =>
    call("/api/graph/nodes/merge", {
      method: "POST",
      body: JSON.stringify({ source_id, target_id }),
    }),
  addRelation: (source_id: string, target_id: string, relation: string, properties = {}) =>
    call("/api/graph/relations", {
      method: "POST",
      body: JSON.stringify({ source_id, target_id, relation, properties }),
    }),
  deleteRelation: (edge_id: string) =>
    call(`/api/graph/relations/${encodeURIComponent(edge_id)}`, { method: "DELETE" }),

  // History
  getHistory: (limit = 50) => call<{ items: ChangeEntry[] }>(`/api/history?limit=${limit}`),

  // Chat
  chat: (question: string) =>
    call<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
};

// ----- Types -----
export type GraphNode = {
  id: string;
  label: string;
  data: Record<string, any>;
  labels: string[];
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: Record<string, any>;
};
export type ChangeEntry = {
  timestamp: string;
  action: string;
  target: string;
  before: any;
  after: any;
  user: string;
};
export type ChatResponse = {
  answer: string;
  cypher: string;
  node_ids: string[];
  edge_ids: string[];
  context: string;
  reasoning: { step: string; detail: string }[];
  scores: { retrieval: number; confidence: number };
};
