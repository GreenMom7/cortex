"use client";
import { useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

const EMBEDDING_OPTIONS = [
  { provider: "sentence-transformers", model: "BAAI/bge-base-en-v1.5", label: "BGE base (HF)" },
  { provider: "sentence-transformers", model: "BAAI/bge-large-en-v1.5", label: "BGE large (HF)" },
  { provider: "sentence-transformers", model: "all-MiniLM-L6-v2", label: "MiniLM-L6 (HF, fast)" },
  { provider: "nvidia", model: "nvidia/nv-embedqa-e5-v5", label: "NVIDIA nv-embedqa-e5" },
  { provider: "openai", model: "text-embedding-3-small", label: "OpenAI 3-small" },
];

export function ChunkingCard() {
  const [size, setSize] = useState(670);
  const [overlap, setOverlap] = useState(10);
  const [embedIdx, setEmbedIdx] = useState(0);

  useEffect(() => {
    api.getStatus().then((s) => {
      setSize(s.chunk_size);
      setOverlap(s.chunk_overlap);
      const i = EMBEDDING_OPTIONS.findIndex(
        (o) => o.provider === s.embedding_provider && o.model === s.embedding_model
      );
      if (i >= 0) setEmbedIdx(i);
    }).catch(() => {});
  }, []);

  async function save() {
    try {
      await api.setChunking(size, overlap);
      await api.setEmbeddings(EMBEDDING_OPTIONS[embedIdx].provider, EMBEDDING_OPTIONS[embedIdx].model);
      toast.success("Chunking + embeddings updated");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <header>
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Scissors size={13} /> Chunking
        </h3>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Size</label>
          <input
            type="number"
            className="input"
            min={128}
            max={4096}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Overlap</label>
          <input
            type="number"
            className="input"
            min={0}
            max={size - 1}
            value={overlap}
            onChange={(e) => setOverlap(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <label className="label">Embedding model</label>
        <select className="input" value={embedIdx} onChange={(e) => setEmbedIdx(Number(e.target.value))}>
          {EMBEDDING_OPTIONS.map((opt, i) => (
            <option key={i} value={i}>{opt.label}</option>
          ))}
        </select>
      </div>

      <button onClick={save} className="btn btn-primary w-full justify-center">
        Apply
      </button>
    </div>
  );
}
