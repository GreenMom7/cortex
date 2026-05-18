"use client";
import { Activity } from "lucide-react";
import { useProgress } from "@/lib/useProgress";

const STAGES = ["idle", "loading", "chunking", "extracting", "ingesting", "done"] as const;

export function ProgressCard({ onDone }: { onDone?: () => void }) {
  const p = useProgress(onDone);
  const stageIdx = STAGES.indexOf(p.stage);
  const pct = p.chunks_total > 0
    ? Math.round((p.chunks_processed / p.chunks_total) * 100)
    : p.stage === "done" ? 100 : 0;

  return (
    <div className="panel p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Activity size={13} /> Progress
        </h3>
        <span className="chip">{p.stage}</span>
      </header>

      {/* Stage dots */}
      <div className="flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-wider">
        {STAGES.slice(1).map((s, i) => {
          const idx = i + 1;
          const active = stageIdx >= idx;
          return (
            <div key={s} className="flex flex-col items-center gap-1 flex-1">
              <div
                className="h-1.5 w-1.5 rounded-full transition-colors"
                style={{ background: active ? "var(--accent)" : "var(--border)" }}
              />
              <span style={{ color: active ? "var(--fg)" : "var(--fg-muted)" }}>{s.slice(0, 4)}</span>
            </div>
          );
        })}
      </div>

      {/* Bar */}
      <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-2 font-mono text-[0.7rem]">
        <Metric label="chunks" value={`${p.chunks_processed}/${p.chunks_total}`} />
        <Metric label="triples" value={String(p.triples_extracted)} />
        <Metric label="ingested" value={String(p.triples_ingested)} />
        <Metric label="percent" value={`${pct}%`} />
      </div>

      {p.message && (
        <p className="font-mono text-[0.7rem] text-muted truncate">{p.message}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-soft px-2 py-1.5">
      <div className="text-[0.55rem] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
