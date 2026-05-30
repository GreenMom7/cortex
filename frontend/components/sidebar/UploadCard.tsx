"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Globe, Trash2, Check, X, Play } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Item = {
  name: string;
  source: string;             // path on the server, or a URL
  size?: number;
  status: "ok" | "err";
  error?: string;
};

export function UploadCard() {
  const [items, setItems] = useState<Item[]>([]);
  const [url, setUrl] = useState("");
  const [clear, setClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
  const savedItems = localStorage.getItem("pipeline_sources");
  const savedClear = localStorage.getItem("pipeline_clear");

  if (savedItems) {
    try {
      setItems(JSON.parse(savedItems));
      const parsed = JSON.parse(savedItems);

      setItems(parsed);
      if (parsed.length > 0) {
        toast.info("Sources restored from browser storage. Re-upload files if the pipeline fails.");
      }
    } catch {
      localStorage.removeItem("pipeline_sources");
    }
  }

  if (savedClear) {
    setClear(savedClear === "true");
  }
}, []);

  useEffect(() => {
    localStorage.setItem("pipeline_sources", JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem("pipeline_clear", String(clear));
  }, [clear]);

  
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const res = await api.uploadFiles(Array.from(files));
      setItems((prev) => [
        ...prev,
        ...res.files.map((f) => ({
          name: f.name, source: f.path, size: f.size_bytes, status: "ok" as const,
        })),
      ]);
      toast.success(`${res.files.length} file(s) uploaded`);
    } catch (e: any) {
      setItems((prev) => [...prev, { name: "upload", source: "", status: "err", error: e.message }]);
      toast.error(e.message);
    }
  }

  function addUrl() {
    if (!url) return;
    setItems((prev) => [
      ...prev,
      { name: url, source: url, status: "ok" as const },
    ]);
    setUrl("");
  }

  function remove(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function run() {
    const sources = items.filter((i) => i.status === "ok").map((i) => i.source);
    if (!sources.length) {
      toast.error("Add at least one source.");
      return;
    }
    try {
      await api.runPipeline(sources, clear);
      toast.success("Pipeline started — watch the progress bar.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <header>
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Upload size={13} /> Sources
        </h3>
      </header>

      {/* Drop / pick */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className="border border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-[var(--bg-soft)] transition-colors"
      >
        <p className="font-mono text-xs text-muted">
          Drop or click to upload<br />
          <span className="text-[0.65rem]">PDF · JSON · CSV</span>
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.json,.csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* URL */}
      <div className="flex gap-1">
        <input
          className="input"
          placeholder="https://… or wikipedia URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addUrl()}
        />
        <button onClick={addUrl} className="btn"><Globe size={13} /></button>
      </div>

      {/* List */}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 panel-soft px-2 py-1.5">
              {it.status === "ok"
                ? <Check size={13} className="text-accent shrink-0" />
                : <X size={13} className="shrink-0" style={{ color: "var(--danger)" }} />}
              <span className="font-mono text-[0.72rem] truncate flex-1" title={it.name}>{it.name}</span>
              {it.size != null && (
                <span className="font-mono text-[0.65rem] text-muted shrink-0">
                  {(it.size / 1024).toFixed(0)} kB
                </span>
              )}
              <button onClick={() => remove(i)} className="btn btn-ghost !p-1">
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="flex items-center gap-2 font-mono text-[0.72rem] text-muted select-none">
        <input
          type="checkbox"
          checked={clear}
          onChange={(e) => setClear(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        clear graph before ingest
      </label>

      <button onClick={run} className="btn btn-primary w-full justify-center">
        <Play size={13} /> Run pipeline
      </button>
    </div>
  );
}
