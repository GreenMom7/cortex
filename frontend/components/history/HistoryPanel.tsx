"use client";
import { History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ChangeEntry } from "@/lib/api";

const UNDOABLE = new Set(["update_node", "add_relation", "update_relation", "delete_relation"]);

export function HistoryPanel({
  refreshKey,
  onUndo,
}: {
  refreshKey: number;
  onUndo?: () => void;
}) {
  const [items, setItems] = useState<ChangeEntry[]>([]);
  const [undoing, setUndoing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getHistory(50).then((r) => setItems(r.items)).catch(() => {});
  }, [refreshKey]);

  async function handleUndo(index: number) {
    setUndoing(index);
    setError(null);
    try {
      await api.undoChange(index);
      const r = await api.getHistory(50);
      setItems(r.items);
      onUndo?.();
    } catch (e: any) {
      setError(e.message ?? "Undo failed");
    } finally {
      setUndoing(null);
    }
  }

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <History size={13} /> Change history
        </h3>
        <span className="chip">{items.length}</span>
      </header>

      {error && (
        <div className="px-4 py-2 text-[0.7rem] font-mono text-red-400 bg-red-950/30 border-b">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {items.length === 0 && (
          <p className="font-mono text-xs text-muted">
            No edits yet. Update or delete a node and it shows up here.
          </p>
        )}
        {items.map((it, i) => (
          <div key={i} className="panel-soft px-3 py-2 font-mono text-[0.72rem]">
            <div className="flex items-center justify-between text-muted text-[0.62rem]">
              <span>{new Date(it.timestamp).toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <span className="text-accent">{it.action}</span>
                {UNDOABLE.has(it.action) && (
                  <button
                    onClick={() => handleUndo(i)}
                    disabled={undoing !== null}
                    title="Undo this change"
                    className="btn btn-ghost p-0.5 rounded"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    <RotateCcw size={11} className={undoing === i ? "animate-spin" : ""} />
                  </button>
                )}
              </div>
            </div>
            <div className="truncate">{it.target}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
