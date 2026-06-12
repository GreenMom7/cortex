"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphCanvasRef, GraphEdge, GraphNode } from "reagraph";
import { Layers, Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut, Plus, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { api, type GraphEdge as MyEdge, type GraphNode as MyNode } from "@/lib/api";
import { toast } from "sonner";
import { useEffect } from "react";

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
  onChange?: () => void;
  onLimitChange?: (limit: number | "All") => void;
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
  onSelectNode, selectedNode, layers, onLayersChange, onChange, onLimitChange
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

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [limit, setLimit] = useState<number | "All">(250);

  useEffect(() => {
    const savedLimit = localStorage.getItem("graphNodeLimit");
    if (savedLimit) {
      const parsedLimit = savedLimit === "All" ? "All" : parseInt(savedLimit, 10);
      setLimit(parsedLimit);
      
      // Tell the parent component to fetch using this saved limit
      onLimitChange?.(parsedLimit); 
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const newLimit = val === "All" ? "All" : parseInt(val, 10);
    
    setLimit(newLimit);
    localStorage.setItem("graphNodeLimit", val); // Persist it
    onLimitChange?.(newLimit); // Tell parent to refetch
  };

  async function confirmAddNode() {
    if (!newLabel.trim()) return;
    setIsAdding(true);
    try {
      // Create the node with a default name property so it's easily identifiable
      const cleanLabel = newLabel.trim();
      const newId = await api.addNode(cleanLabel, { name: `New ${cleanLabel}` });
      toast.success("Node created!", {
        description: "Don't see it? Try increasing your graph limit filter."
      });
      setShowAddNode(false);
      setNewLabel(""); // reset for next time
      
      onChange?.(); // Refresh the graph
      onSelectNode?.(newId); // Auto-select the new node to open NodeDetails

      setFocusNodeId(newId);
    } catch (e: any) {
      toast.error(e.message || "Failed to create node");
    } finally {
      setIsAdding(false);
    }
  }

  // Build the set of classes actually present, for the legend
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

  useEffect(() => {
    if (focusNodeId && nodes.some(n => n.id === focusNodeId)) {      
      setTimeout(() => {
        ref.current?.fitNodesInView([focusNodeId]);         
        setFocusNodeId(null); 
      }, 300);
    }
  }, [nodes, focusNodeId]);

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

      {/* Node Limit Selector — top-right */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2 z-10">
        <div className="panel flex items-center gap-2 p-1.5 px-3 font-mono text-[0.7rem] shadow-sm">
          <label htmlFor="nodeLimit" className="text-muted">Display Limit:</label>
          <select
            id="nodeLimit"
            value={limit}
            onChange={handleLimitChange}
            className="bg-transparent text-fg outline-none cursor-pointer font-semibold"
          >
            <option className="bg-[var(--bg-elev)]" value={250}>250 (Small)</option>
            <option className="bg-[var(--bg-elev)]" value={500}>500 (Medium)</option>
            <option className="bg-[var(--bg-elev)]" value={1000}>1000 (Large)</option>
            <option className="bg-[var(--bg-elev)]" value="All">All (Unlimited)</option>
          </select>
        </div>
        
        {/* Warning Badge for "All" */}
        {limit === "All" && (
          <div className="panel flex items-start gap-1.5 p-2 max-w-[220px] font-mono text-[0.65rem] border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400 animate-pulse">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p><strong>Warning:</strong> Loading all nodes may cause severe performance lag on large datasets.</p>
          </div>
        )}
      </div>

      {/* Floating controls — bottom-right */}
      <div className="absolute bottom-4 right-4 flex flex-col items-center">
        
        {/* Separate Plus Button (Top) */}
        <button 
          className="btn btn-primary !p-2 mb-2 shadow-md" 
          title="Add New Node" 
          onClick={() => setShowAddNode(true)}
        >
          <Plus size={14} />
        </button>

        {/* Floating controls — bottom-right */}
        <div className="flex flex-col gap-2 panel p-1.5">
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
      </div>

      {/* Counts — bottom-left */}
      <div className="absolute bottom-4 left-4 font-mono text-[0.7rem] text-muted">
        <span className="chip">{visibleNodes.length} nodes</span>{" "}
        <span className="chip">{visibleEdges.length} edges</span>
      </div>

      {/* ADD NODE DIALOG OVERLAY */}
      {showAddNode && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
        >
          <div 
            className="panel w-full max-w-xs p-5 animate-slide-up shadow-xl"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Plus size={16} className="text-primary" />
              <h3 className="font-mono text-sm font-semibold">Create New Node</h3>
            </div>
            
            <div className="mb-4">
              <label className="label">Class / Label</label>
              <input
                autoFocus
                className="input w-full"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmAddNode()}
                placeholder="e.g. Concept"
                disabled={isAdding}
                list="label-suggestions"
              />

              {/* Native HTML datalist for autocomplete suggestions */}
              <datalist id="label-suggestions">
                {classesPresent.map((cls) => (
                  <option key={cls} value={cls} />
                ))}
              </datalist>
            </div>

            <div className="flex justify-end gap-2">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowAddNode(false)} 
                disabled={isAdding}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={confirmAddNode} 
                disabled={isAdding}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
