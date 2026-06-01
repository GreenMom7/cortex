"use client";
import { useCallback, useMemo, useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { GraphView } from "@/components/graph/GraphView";
import { NodeDetails } from "@/components/graph/NodeDetails";
import { ChatPanel , Turn } from "@/components/chat/ChatPanel";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { SchemaPanel } from "@/components/graph/SchemaPanel";
import { useGraph } from "@/lib/useGraph";

export default function Page() {
  const { nodes, edges, refresh } = useGraph();
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightNodes, setHN] = useState<string[]>([]);
  const [highlightEdges, setHE] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState<"chat" | "node" | "history" | "schema">("chat");
  const [historyBump, setHistoryBump] = useState(0);
  const [chatTurns, setChatTurns] = useState<Turn[]>([]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selected) || null,
    [nodes, selected]
  );

  const handleSelectNode = useCallback((id: string | null) => {
    setSelected(id);
    if (id) setRightTab("node");
  }, []);

  const handleGraphRefresh = useCallback(() => {
    refresh();
    setHistoryBump((b) => b + 1);
  }, [refresh]);

  const handleHighlight = useCallback((ns: string[], es: string[]) => {
    setHN(ns);
    setHE(es);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      <Navbar />

      {/* Three-column grid that collapses on narrow viewports */}
      <main
        className="
          grid gap-3 px-4 py-3 flex-1 min-h-0
          grid-cols-1
          lg:grid-cols-[300px_minmax(0,1fr)_360px]
        "
      >
        {/* LEFT — sidebar */}
        <Sidebar onGraphRefresh={handleGraphRefresh} />

        {/* CENTER — graph canvas */}
        <section className="panel relative overflow-hidden min-h-[420px]">
          <GraphView
            nodes={nodes}
            edges={edges}
            highlightNodes={highlightNodes}
            highlightEdges={highlightEdges}
            onSelectNode={handleSelectNode}
            selectedNode={selected}
          />
        </section>

        {/* RIGHT — tabbed pane */}
        <section className="flex flex-col gap-2 min-h-[420px]">
          <nav className="flex gap-1 panel p-1">
            {(["chat", "node", "history", "schema"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className="btn btn-ghost flex-1 justify-center"
                style={{
                  background:
                    rightTab === tab ? "var(--accent-soft)" : "transparent",
                  color: rightTab === tab ? "var(--accent)" : "var(--fg-muted)",
                }}
              >
                {tab}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-h-0">
            {rightTab === "chat" && <ChatPanel turns={chatTurns} setTurns={setChatTurns} onHighlight={handleHighlight} />}
            {rightTab === "node" && (
              <NodeDetails
                node={selectedNode}
                nodes={nodes}
                edges={edges}
                onChange={handleGraphRefresh}
                onClose={() => setSelected(null)}
              />
            )}
            {rightTab === "history" && <HistoryPanel refreshKey={historyBump} onUndo={handleGraphRefresh} />}
            {rightTab === "schema" && <SchemaPanel refreshKey={historyBump} />}
          </div>
        </section>
      </main>
    </div>
  );
}
