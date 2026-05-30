"use client";
import { useRef, useState } from "react";
import { Send, MessageSquare, Code2, BrainCircuit } from "lucide-react";
import { api, ChatResponse } from "@/lib/api";
import { toast } from "sonner";

export type Turn = {
  q: string;
  r: ChatResponse | null;
  loading: boolean;
};

export function ChatPanel({
  turns,
  setTurns,
  onHighlight,
}: {
  turns: Turn[];
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  onHighlight: (nodes: string[], edges: string[]) => void;

}) {
  const [q, setQ] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  async function ask() {
    if (!q.trim()) return;
    const question = q.trim();
    setQ("");

    const turn: Turn = { q: question, r: null, loading: true };
    setTurns((prev) => [...prev, turn]);
    setTimeout(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);

    try {
      const r = await api.chat(question);
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, r, loading: false } : t)));
      onHighlight(r.node_ids, r.edge_ids);
      setTimeout(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
    } catch (e: any) {
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, loading: false } : t)));
      toast.error(e.message);
    }
  }

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <MessageSquare size={13} /> Ask the graph
        </h3>
        {turns.length > 0 && (
          <button onClick={() => { setTurns([]); onHighlight([], []); }} className="btn btn-ghost !text-[0.65rem]">
            clear
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {turns.length === 0 && (
          <div className="text-center py-8 font-mono text-xs text-muted space-y-2">
            <p>Try:</p>
            <p>— Who is Amazon accused by?</p>
            <p>— Which teams played the Super Bowl preview?</p>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-3 animate-fade-in">
            <div className="font-mono text-[0.75rem]">
              <span className="text-accent">›</span>{" "}
              <span>{t.q}</span>
            </div>

            {t.loading && (
              <div className="font-mono text-[0.72rem] text-muted">thinking…</div>
            )}

            {t.r && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{t.r.answer}</p>

                {/* Cypher */}
                <details className="panel-soft px-3 py-2 group">
                  <summary className="cursor-pointer font-mono text-[0.65rem] uppercase tracking-wider text-muted flex items-center gap-1">
                    <Code2 size={11} /> Cypher
                  </summary>
                  <pre className="mt-2 font-mono text-[0.7rem] text-accent whitespace-pre-wrap">{t.r.cypher}</pre>
                </details>

                {/* Reasoning */}
                <details className="panel-soft px-3 py-2">
                  <summary className="cursor-pointer font-mono text-[0.65rem] uppercase tracking-wider text-muted flex items-center gap-1">
                    <BrainCircuit size={11} /> Reasoning
                  </summary>
                  <ol className="mt-2 space-y-1 font-mono text-[0.7rem]">
                    {t.r.reasoning.map((s, j) => (
                      <li key={j} className="text-muted">
                        <span className="text-accent">{j + 1}.</span> <span>{s.step}</span>{" "}
                        — <span>{s.detail}</span>
                      </li>
                    ))}
                  </ol>
                </details>

                {/* Scores */}
                <div className="flex gap-2">
                  <ScorePill label="retrieval" value={t.r.scores.retrieval} />
                  <ScorePill label="confidence" value={t.r.scores.confidence} />
                  <span className="chip">{t.r.node_ids.length} nodes lit</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t px-3 py-2 flex gap-2">
        <input
          className="input"
          placeholder="ask anything about the graph"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button onClick={ask} className="btn btn-primary">
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-1.5 chip">
      <span className="text-[0.6rem] uppercase">{label}</span>
      <span className="font-semibold">{pct}%</span>
    </div>
  );
}
