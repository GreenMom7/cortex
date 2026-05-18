"use client";
import { useEffect, useState } from "react";
import { Check, X, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function LLMConfigCard() {
  const [providers, setProviders] = useState<Record<string, string[]>>({});
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listProviders().then((r) => setProviders(r.providers)).catch(() => {});
    // Rehydrate from backend session so a page refresh doesn't blank the UI.
    api.getStatus().then((s) => {
      if (s.llm_provider) {
        setProvider(s.llm_provider);
        setModel(s.llm_model);
        setStatus("ok");
      }
    }).catch(() => {});
  }, []);

  async function save() {
    if (!provider || !model || !apiKey) {
      toast.error("Provider, model and API key are required.");
      return;
    }
    setLoading(true);
    try {
      await api.setLLM(provider, model, apiKey);
      setStatus("ok");
      toast.success(`${provider}/${model} is live.`);
    } catch (e: any) {
      setStatus("err");
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Cpu size={13} /> LLM
        </h3>
        {status === "ok" && <span className="chip chip-ok"><Check size={11} /> Live</span>}
        {status === "err" && <span className="chip chip-err"><X size={11} /> Failed</span>}
      </header>

      <div>
        <label className="label">Provider</label>
        <select
          className="input"
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setModel(""); }}
        >
          <option value="">Choose…</option>
          {Object.keys(providers).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Model</label>
        <select
          className="input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={!provider}
        >
          <option value="">Choose…</option>
          {(providers[provider] || []).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">API key</label>
        <input
          type="password"
          className="input"
          placeholder="sk-... / nvapi-... / gsk_... etc."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <button onClick={save} disabled={loading} className="btn btn-primary w-full justify-center">
        {loading ? "Testing…" : "Save & test"}
      </button>
    </div>
  );
}
