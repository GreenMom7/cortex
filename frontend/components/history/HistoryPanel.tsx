"use client";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ChangeEntry } from "@/lib/api";

export function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ChangeEntry[]>([]);

  useEffect(() => {
    api.getHistory(50).then((r) => setItems(r.items)).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <History size={13} /> Change history
        </h3>
        <span className="chip">{items.length}</span>
      </header>

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
              <span className="text-accent">{it.action}</span>
            </div>
            <div className="truncate">{it.target}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
