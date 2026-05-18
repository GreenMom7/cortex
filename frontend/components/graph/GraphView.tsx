"use client";
import { useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import type { GraphCanvasRef, GraphEdge, GraphNode } from "reagraph";
import { Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { GraphEdge as MyEdge, GraphNode as MyNode } from "@/lib/api";

// reagraph uses WebGL; must be client-only
const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

type Props = {
  nodes: MyNode[];
  edges: MyEdge[];
  highlightNodes?: string[];
  highlightEdges?: string[];
  onSelectNode?: (id: string | null) => void;
  selectedNode?: string | null;
};

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode,
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<GraphCanvasRef | null>(null);

  // Translate our shape into reagraph's shape + apply highlight styling
  const rgNodes: GraphNode[] = useMemo(
    () =>
      nodes.map((n) => {
        const isHi = highlightNodes.includes(n.id);
        const isSel = selectedNode === n.id;
        return {
          id: n.id,
          label: n.label,
          fill: isSel ? "#1e9352" : isHi ? "#74cf94" : theme === "dark" ? "#2a2f2b" : "#eef0ef",
          data: n.data,
          size: isSel || isHi ? 10 : 7,
        } satisfies GraphNode;
      }),
    [nodes, highlightNodes, selectedNode, theme]
  );

  const rgEdges: GraphEdge[] = useMemo(
    () =>
      edges.map((e) => {
        const isHi = highlightEdges.includes(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          size: isHi ? 2.5 : 1,
          fill: isHi ? "#1e9352" : theme === "dark" ? "#3f4640" : "#b4bab5",
        } satisfies GraphEdge;
      }),
    [edges, highlightEdges, theme]
  );

  const themeObj = useMemo(
    () =>
      theme === "dark"
        ? {
            canvas: { background: "transparent" },
            node: {
              fill: "#2a2f2b", activeFill: "#74cf94",
              opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.35,
              label: { color: "#e7ebe8", stroke: "#0f1311", activeColor: "#74cf94" },
            },
            ring: { fill: "#1e9352", activeFill: "#74cf94" },
            edge: {
              fill: "#3f4640", activeFill: "#74cf94",
              opacity: 0.7, selectedOpacity: 1, inactiveOpacity: 0.2,
              label: { color: "#95a098", stroke: "#0f1311", activeColor: "#74cf94" },
            },
            arrow: { fill: "#3f4640", activeFill: "#74cf94" },
            lasso: { border: "#74cf94", background: "rgba(116, 207, 148, 0.15)" },
          }
        : {
            canvas: { background: "transparent" },
            node: {
              fill: "#eef0ef", activeFill: "#1e9352",
              opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.35,
              label: { color: "#191c1a", stroke: "#ffffff", activeColor: "#1e9352" },
            },
            ring: { fill: "#1e9352", activeFill: "#1e9352" },
            edge: {
              fill: "#b4bab5", activeFill: "#1e9352",
              opacity: 0.6, selectedOpacity: 1, inactiveOpacity: 0.2,
              label: { color: "#5a635c", stroke: "#ffffff", activeColor: "#1e9352" },
            },
            arrow: { fill: "#b4bab5", activeFill: "#1e9352" },
            lasso: { border: "#1e9352", background: "rgba(30, 147, 82, 0.12)" },
          },
    [theme]
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GraphCanvas
        ref={ref}
        nodes={rgNodes}
        edges={rgEdges}
        theme={themeObj as any}
        layoutType="forceDirected2d"
        labelType="all"
        edgeArrowPosition="end"
        draggable
        animated
        onNodeClick={(n) => onSelectNode?.(n.id)}
        onCanvasClick={() => onSelectNode?.(null)}
      />

      {/* Floating controls — bottom-right */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 panel p-1.5">
        <button className="btn btn-ghost !p-2" title="Zoom in" onClick={() => ref.current?.zoomIn()}>
          <ZoomIn size={14} />
        </button>
        <button className="btn btn-ghost !p-2" title="Zoom out" onClick={() => ref.current?.zoomOut()}>
          <ZoomOut size={14} />
        </button>
        <button className="btn btn-ghost !p-2" title="Fit" onClick={() => ref.current?.fitNodesInView()}>
          <Maximize2 size={14} />
        </button>
        <button className="btn btn-ghost !p-2" title="Center" onClick={() => ref.current?.centerGraph()}>
          <Minimize2 size={14} />
        </button>
        <button
          className="btn btn-ghost !p-2"
          title="Re-fit"
          onClick={() => ref.current?.fitNodesInView()}
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* Counts — bottom-left */}
      <div className="absolute bottom-4 left-4 font-mono text-[0.7rem] text-muted">
        <span className="chip">{nodes.length} nodes</span>{" "}
        <span className="chip">{edges.length} edges</span>
      </div>
    </div>
  );
}
