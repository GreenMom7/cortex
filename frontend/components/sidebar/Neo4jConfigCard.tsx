"use client";
import { useEffect, useRef, useState } from "react";
import { Check, X, Database, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

/** Parse the Aura "Download .env" file (or any KEY=VALUE text). */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function Neo4jConfigCard({ onConnected }: { onConnected?: () => void }) {
  const [uri, setUri] = useState("neo4j+s://");
  const [user, setUser] = useState("neo4j");
  const [pw, setPw] = useState("");
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Rehydrate UI from backend session (password is not exposed by design).
    api.getStatus().then((s) => {
      if (s.neo4j_connected) setStatus("ok");
    }).catch(() => {});
    api.neo4jStatus().then(() => {}).catch(() => {});
  }, []);

  async function connect(uriArg = uri, userArg = user, pwArg = pw) {
    setLoading(true);
    try {
      await api.connectNeo4j(uriArg, userArg, pwArg);
      setStatus("ok");
      toast.success("Neo4j connected");
      onConnected?.();
    } catch (e: any) {
      setStatus("err");
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnvFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const env = parseEnv(text);
      const nextUri = env.NEO4J_URI || "";
      const nextUser = env.NEO4J_USERNAME || "neo4j";
      const nextPw = env.NEO4J_PASSWORD || "";
      if (!nextUri || !nextPw) {
        toast.error("File missing NEO4J_URI or NEO4J_PASSWORD.");
        return;
      }
      setUri(nextUri);
      setUser(nextUser);
      setPw(nextPw);
      toast.success("Loaded — connecting…");
      await connect(nextUri, nextUser, nextPw);
    } catch (e: any) {
      toast.error(`Could not read file: ${e.message}`);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Database size={13} /> Neo4j
        </h3>
        {status === "ok" && <span className="chip chip-ok"><Check size={11} /> Connected</span>}
        {status === "err" && <span className="chip chip-err"><X size={11} /> Failed</span>}
      </header>

      {/* Aura .env upload */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleEnvFile(e.dataTransfer.files?.[0] ?? null); }}
        onClick={() => fileRef.current?.click()}
        className="border border-dashed rounded-lg p-3 text-center cursor-pointer hover:bg-[var(--bg-soft)] transition-colors"
      >
        <p className="font-mono text-[0.7rem] text-muted flex items-center justify-center gap-1.5">
          <Upload size={11} /> Drop Aura .env file
        </p>
        <p className="font-mono text-[0.6rem] text-muted mt-0.5">auto-fills URI / user / password</p>
        <input
          ref={fileRef}
          type="file"
          accept=".env,.txt,text/plain"
          className="hidden"
          onChange={(e) => handleEnvFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div><label className="label">URI</label>
        <input className="input" value={uri} onChange={(e) => setUri(e.target.value)} />
      </div>
      <div><label className="label">Username</label>
        <input className="input" value={user} onChange={(e) => setUser(e.target.value)} />
      </div>
      <div><label className="label">Password</label>
        <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>

      <button onClick={() => connect()} disabled={loading} className="btn btn-primary w-full justify-center">
        {loading ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}
