"use client";
import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function LLMConfigCard() {
  const [providers, setProviders] = useState<Record<string, string[]>>({});
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listProviders()
      .then((r) => setProviders({ ...r.providers, custom: [] }))
      .catch(() => setProviders({ custom: [] }));

    const savedProvider = localStorage.getItem("llm_provider");
    const savedModel = localStorage.getItem("llm_model");
    const savedApiKey = localStorage.getItem("llm_api_key");
    const savedBaseUrl = localStorage.getItem("llm_base_url");

    if (savedProvider) setProvider(savedProvider);
    if (savedModel) setModel(savedModel);
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedBaseUrl) setBaseUrl(savedBaseUrl);

    setStatus("idle");

    if (savedProvider && savedModel && savedApiKey) {
      api.setLLM(savedProvider, savedModel, savedApiKey, savedBaseUrl || undefined)
        .then(() => setStatus("ok"))
        .catch(() => setStatus("err"));
    }
  }, []);

  async function save() {
    if (!provider || !model || !apiKey) {
      toast.error("Provider, model and API key are required.");
      return;
    }

    if (provider === "custom" && !baseUrl) {
      toast.error("Base URL is required for custom providers.");
      return;
    }

    setLoading(true);
    try {
      await api.setLLM(provider, model, apiKey, baseUrl || undefined);

      localStorage.setItem("llm_provider", provider);
      localStorage.setItem("llm_model", model);
      localStorage.setItem("llm_api_key", apiKey);
      localStorage.setItem("llm_base_url", baseUrl);

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
        {status === "ok" && <span className="chip chip-ok">Live</span>}
        {status === "err" && <span className="chip chip-err">Failed</span>}
        {status === "idle" && <span className="chip">Not configured</span>}
      </header>

      <div>
        <label className="label">Provider</label>
        <select
          className="input"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
          }}
        >
          <option value="">Choose…</option>
          {Object.keys(providers).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {provider === "custom" && (
        <div>
          <label className="label">Base URL</label>
          <input
            type="text"
            className="input"
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      )}

      <div>
        <label className="label">Model</label>
        {provider === "custom" ? (
          <input
            type="text"
            className="input"
            placeholder="model-name"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        ) : (
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!provider}
          >
            <option value="">Choose…</option>
            {(providers[provider] || []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
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

      <button
        onClick={save}
        disabled={loading}
        className="btn btn-primary w-full justify-center"
      >
        {loading ? "Testing…" : "Save & test"}
      </button>
    </div>
  );
}
