"use client";
import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphCanvasRef, GraphEdge, GraphNode } from "reagraph";
import { Layers, Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { GraphEdge as MyEdge, GraphNode as MyNode } from "@/lib/api";

const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

type Props = {
  nodes: MyNode[];
  edges: MyEdge[];
  highlightNodes?: string[];
  highlightEdges?: string[];
  onSelectNode?: (id: string | null) => void;
  selectedNode?: string | null;
  layers: "entity" | "all";
  onLayersChange: (layers: "entity" | "all") => void;
};

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

const LAYER_COLORS: Record<string, string> = {
  document: "#4a90d9",
  chunk:    "#8b8b8b",
};

const LAYER_SIZES: Record<string, number> = {
  document: 22,
  chunk:    8,
  entity:   14,
};

const FALLBACK_COLOR = "#b8b1a0";

function getLayer(labels: string[] | undefined): string {
  if (!labels) return "entity";
  if (labels.includes("Document")) return "document";
  if (labels.includes("Chunk")) return "chunk";
  return "entity";
}

function pickClass(labels: string[] | undefined): string {
  if (!labels?.length) return "Entity";
  const specific = labels.find((l) => l !== "Entity");
  return specific || labels[0];
}

function getNodeColor(labels: string[] | undefined): string {
  const layer = getLayer(labels);
  if (layer !== "entity") return LAYER_COLORS[layer] || FALLBACK_COLOR;
  const cls = pickClass(labels);
  return CLASS_COLORS[cls] || FALLBACK_COLOR;
}

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode, layers, onLayersChange,
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<GraphCanvasRef | null>(null);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());

  const toggleLayer = (layer: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const visibleNodes = useMemo(() => {
    if (hiddenLayers.size === 0) return nodes;
    return nodes.filter((n) => !hiddenLayers.has(getLayer(n.labels)));
  }, [nodes, hiddenLayers]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    if (hiddenLayers.size === 0) return edges;
    return edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  }, [edges, visibleNodeIds, hiddenLayers]);

  const classesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const n of visibleNodes) {
      if (getLayer(n.labels) === "entity") set.add(pickClass(n.labels));
    }
    return Array.from(set).sort();
  }, [visibleNodes]);

  const layersPresent = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) set.add(getLayer(n.labels));
    return Array.from(set);
  }, [nodes]);

  const rgNodes: GraphNode[] = useMemo(
    () =>
      visibleNodes.map((n) => {
        const isHi = highlightNodes.includes(n.id);
        const isSel = selectedNode === n.id;
        const layer = getLayer(n.labels);
        const base = getNodeColor(n.labels);
        const size = LAYER_SIZES[layer] || 14;
        return {
          id: n.id,
          label: n.label,
          fill: isSel ? "#1e9352" : isHi ? "#74cf94" : base,
          data: { ...n.data, _class: pickClass(n.labels), _layer: layer },
          size: isSel || isHi ? size + 4 : size,
        } satisfies GraphNode;
      }),
    [visibleNodes, highlightNodes, selectedNode]
  );

  const rgEdges: GraphEdge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
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
    [visibleEdges, highlightEdges, theme]
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
      <div className="absolute top-3 left-3 panel p-2 space-y-2 font-mono text-[0.65rem]">
        {/* Layer toggle */}
        <div className="flex items-center gap-1.5 pb-1 border-b border-[var(--border)]">
          <button
            onClick={() => onLayersChange(layers === "all" ? "entity" : "all")}
            className="btn btn-ghost !p-1"
            title={layers === "all" ? "Show entities only" : "Show all layers"}
          >
            <Layers size={12} />
          </button>
          <span className="text-muted">{layers === "all" ? "All layers" : "Entities"}</span>
        </div>

        {/* Layer indicators (when showing all layers) */}
        {layers === "all" && (
          <div className="space-y-1 pb-1 border-b border-[var(--border)]">
            {(["document", "chunk", "entity"] as const).map((l) => (
              <button
                key={l}
                className="flex items-center gap-1.5 w-full text-left"
                onClick={() => toggleLayer(l)}
                style={{ opacity: hiddenLayers.has(l) ? 0.35 : 1 }}
              >
                <span
                  className="inline-block rounded-full"
                  style={{
                    background: l === "entity" ? FALLBACK_COLOR : LAYER_COLORS[l],
                    width: l === "document" ? 10 : l === "chunk" ? 5 : 8,
                    height: l === "document" ? 10 : l === "chunk" ? 5 : 8,
                  }}
                />
                <span className="capitalize">{l}</span>
              </button>
            ))}
          </div>
        )}

        {/* Entity type colors */}
        {classesPresent.length > 1 && (
          <div className="space-y-1">
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
      </div>

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
        <span className="chip">{visibleNodes.length} nodes</span>{" "}
        <span className="chip">{visibleEdges.length} edges</span>
      </div>
    </div>
  );
}
