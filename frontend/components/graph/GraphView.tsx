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

// Per-class palette. Picked for distinguishability on both backgrounds.
// "Entity" is the catch-all legacy label every node also carries; the picker
// below ignores it and prefers the more specific type.
const CLASS_COLORS: Record<string, string> = {
  Person:       "#e89f8e",
  Place:        "#7fa6d6",
  Organization: "#a08bd1",
  Event:        "#d4a248",
  Date:         "#9aa3ab",
  Work:         "#5fb0a5",
  Concept:      "#7fc191",
  Object:       "#b5856b",
  Other:        "#b8b1a0",
  Entity:       "#b8b1a0",
};
const FALLBACK_COLOR = "#b8b1a0";

function pickClass(labels: string[] | undefined): string {
  if (!labels?.length) return "Entity";
  const specific = labels.find((l) => l !== "Entity");
  return specific || labels[0];
}

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode,
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<GraphCanvasRef | null>(null);

  // Build the set of classes actually present, for the legend
  const classesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) set.add(pickClass(n.labels));
    return Array.from(set).sort();
  }, [nodes]);

  const rgNodes: GraphNode[] = useMemo(
    () =>
      nodes.map((n) => {
        const isHi = highlightNodes.includes(n.id);
        const isSel = selectedNode === n.id;
        const cls = pickClass(n.labels);
        const base = CLASS_COLORS[cls] || FALLBACK_COLOR;
        return {
          id: n.id,
          label: n.label,
          fill: isSel ? "#1e9352" : isHi ? "#74cf94" : base,
          data: { ...n.data, _class: cls },
          // Node size in reagraph is in 3D units, not px. ~14 reads as a
          // proper bubble with the label sitting on top of it.
          size: isSel || isHi ? 18 : 14,
        } satisfies GraphNode;
      }),
    [nodes, highlightNodes, selectedNode]
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
          size: isHi ? 3 : 1.6,
          fill: isHi ? "#1e9352" : theme === "dark" ? "#5a635c" : "#7a847e",
        } satisfies GraphEdge;
      }),
    [edges, highlightEdges, theme]
  );

  const themeObj = useMemo(
    () =>
      theme === "dark"
        ? {
            canvas: { background: "#161b18" },
            node: {
              fill: "#2a2f2b", activeFill: "#74cf94",
              opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.4,
              label: {
                color: "#f5f7f5", stroke: "#0f1311",
                activeColor: "#74cf94", fontSize: 11,
              },
            },
            ring: { fill: "#1e9352", activeFill: "#74cf94" },
            edge: {
              fill: "#5a635c", activeFill: "#74cf94",
              opacity: 0.9, selectedOpacity: 1, inactiveOpacity: 0.25,
              label: {
                color: "#e7ebe8", stroke: "#0f1311",
                activeColor: "#74cf94", fontSize: 8, fontWeight: 700,
              },
            },
            arrow: { fill: "#5a635c", activeFill: "#74cf94" },
            lasso: { border: "#74cf94", background: "rgba(116, 207, 148, 0.15)" },
          }
        : {
            // Soft warm-paper background so dark edges + labels read clearly
            canvas: { background: "#ecefe9" },
            node: {
              fill: "#eef0ef", activeFill: "#1e9352",
              opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.4,
              label: {
                color: "#0d100e", stroke: "#ffffff",
                activeColor: "#1e9352", fontSize: 11,
              },
            },
            ring: { fill: "#1e9352", activeFill: "#1e9352" },
            edge: {
              fill: "#7a847e", activeFill: "#1e9352",
              opacity: 0.95, selectedOpacity: 1, inactiveOpacity: 0.25,
              label: {
                color: "#1a201d", stroke: "#ffffff",
                activeColor: "#1e9352", fontSize: 8, fontWeight: 700,
              },
            },
            arrow: { fill: "#7a847e", activeFill: "#1e9352" },
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
        edgeLabelPosition="natural"
        draggable
        animated
        onNodeClick={(n) => onSelectNode?.(n.id)}
        onCanvasClick={() => onSelectNode?.(null)}
      />

      {/* Legend — top-left */}
      {classesPresent.length > 1 && (
        <div className="absolute top-3 left-3 panel p-2 space-y-1 font-mono text-[0.65rem]">
          {classesPresent.map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: CLASS_COLORS[c] || FALLBACK_COLOR }}
              />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

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
