"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import { Layers, Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut, Plus, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { api, type GraphEdge as MyEdge, type GraphNode as MyNode } from "@/lib/api";
import { toast } from "sonner";
import { useEffect } from "react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

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

const SIZE_SCALE = 0.5;

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

type RGNode = NodeObject & {
  id: string;
  label: string;
  fill: string;
  size: number;
  data: Record<string, any>;
};
type RGEdge = LinkObject & {
  id: string;
  source: string | RGNode;
  target: string | RGNode;
  label: string;
};

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode, layers, onLayersChange, onChange, onLimitChange
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<ForceGraphMethods<RGNode, RGEdge> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // react-force-graph needs explicit pixel dimensions; track the container.
  const [dims, setDims] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Node/link objects must stay referentially stable across selection,
  // highlight and theme changes: react-force-graph stores simulation state
  // (x/y/vx/vy and fx/fy pins) on these objects, so rebuilding them resets
  // the layout. Memoize on data only; styling happens in the paint callbacks.
  const rgNodes: RGNode[] = useMemo(
    () =>
      visibleNodes.map((n) => {
        const layer = getLayer(n.labels);
        return {
          id: n.id,
          label: n.label,
          fill: getNodeColor(n.labels),
          data: { ...n.data, _class: pickClass(n.labels), _layer: layer },
          size: LAYER_SIZES[layer] || 14,
        } satisfies RGNode;
      }),
    [visibleNodes]
  );

  const rgEdges: RGEdge[] = useMemo(
    () =>
      visibleEdges.map(
        (e) =>
          ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
          }) satisfies RGEdge
      ),
    [visibleEdges]
  );

  const highlightNodeSet = useMemo(() => new Set(highlightNodes), [highlightNodes]);
  const highlightEdgeSet = useMemo(() => new Set(highlightEdges), [highlightEdges]);

  const graphData = useMemo(
    () => ({ nodes: rgNodes, links: rgEdges }),
    [rgNodes, rgEdges]
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
        const target = graphData.nodes.find((n) => n.id === focusNodeId);
        if (target && target.x != null && target.y != null) {
          ref.current?.centerAt(target.x, target.y, 600);
          ref.current?.zoom(2.5, 600);
        }
        setFocusNodeId(null); 
      }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, focusNodeId]);

  // Draw node bubble + label (replaces reagraph's labelType="all")
  const drawNode = useCallback(
    (node: RGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isSel = selectedNode === node.id;
      const isHi = highlightNodeSet.has(node.id);
      const r = (isSel || isHi ? node.size + 4 : node.size) * SIZE_SCALE;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = isSel ? "#1e9352" : isHi ? "#74cf94" : node.fill;
      ctx.fill();

      // Label under the bubble, with a stroke for readability
      if (node.data?._layer === "chunk" && globalScale < 2) return;
      const fontSize = Math.max(themeObj.node.label.fontSize / globalScale, 2.5);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = fontSize / 4;
      ctx.strokeStyle = themeObj.node.label.stroke;
      ctx.strokeText(node.label, node.x!, node.y! + r + 2);
      ctx.fillStyle = themeObj.node.label.color;
      ctx.fillText(node.label, node.x!, node.y! + r + 2);
    },
    [themeObj, selectedNode, highlightNodeSet]
  );

  // Pointer hit-area must match the drawn bubble + label
  const drawNodePointerArea = useCallback(
    (node: RGNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, node.size * SIZE_SCALE + 4, 0, 2 * Math.PI);
      ctx.fill();
    },
    []
  );

  // Edge label at the midpoint (replaces edgeLabelPosition="natural")
  const drawEdgeLabel = useCallback(
    (link: RGEdge, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source as RGNode;
      const end = link.target as RGNode;
      if (typeof start !== "object" || typeof end !== "object") return;
      if (!link.label || globalScale < 1.2) return; // declutter when zoomed out

      const mx = (start.x! + end.x!) / 2;
      const my = (start.y! + end.y!) / 2;
      const fontSize = Math.max(themeObj.edge.label.fontSize / globalScale, 2);
      ctx.font = `${themeObj.edge.label.fontWeight} ${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = fontSize / 4;
      ctx.strokeStyle = themeObj.edge.label.stroke;
      ctx.strokeText(link.label, mx, my);
      ctx.fillStyle = themeObj.edge.label.color;
      ctx.fillText(link.label, mx, my);
    },
    [themeObj]
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <ForceGraph2D
        ref={ref as any}
        width={dims.width}
        height={dims.height}
        graphData={graphData}
        backgroundColor={themeObj.canvas.background}
        // --- Nodes ---
        nodeCanvasObject={drawNode as any}
        nodePointerAreaPaint={drawNodePointerArea as any}
        nodeVal={(n: any) => n.size * SIZE_SCALE}
        // --- Edges ---
        linkColor={(l: any) => (highlightEdgeSet.has(l.id) ? "#1e9352" : themeObj.edge.fill)}
        linkWidth={(l: any) => (highlightEdgeSet.has(l.id) ? 3 : 1.6)}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1} // arrow at the end, like edgeArrowPosition="end"
        linkCanvasObjectMode={() => "after"}
        linkCanvasObject={drawEdgeLabel as any}
        // --- Interaction: Neo4j-style live drag ---
        // Dragging is enabled by default; the simulation re-heats on drag so
        // connected nodes follow. d3AlphaDecay/VelocityDecay tuned so the
        // graph settles quickly but still feels springy while dragging.
        enableNodeDrag
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.35}
        cooldownTime={4000}
        onNodeDragEnd={(node: any) => {
          // Pin the node where the user dropped it (Neo4j Browser behavior).
          // Remove these two lines if nodes should drift back instead.
          node.fx = node.x;
          node.fy = node.y;
        }}
        onNodeClick={(n: any) => onSelectNode?.(n.id)}
        onBackgroundClick={() => onSelectNode?.(null)}
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
          <button className="btn btn-ghost !p-2" title="Zoom in" onClick={() => ref.current?.zoom(ref.current.zoom() * 1.4, 250)}>
            <ZoomIn size={14} />
          </button>
          <button className="btn btn-ghost !p-2" title="Zoom out" onClick={() => ref.current?.zoom(ref.current.zoom() / 1.4, 250)}>
            <ZoomOut size={14} />
          </button>
          <button className="btn btn-ghost !p-2" title="Fit" onClick={() => ref.current?.zoomToFit(400, 40)}>
            <Maximize2 size={14} />
          </button>
          <button className="btn btn-ghost !p-2" title="Center" onClick={() => ref.current?.centerAt(0, 0, 400)}>
            <Minimize2 size={14} />
          </button>
          <button
            className="btn btn-ghost !p-2"
            title="Re-fit"
            onClick={() => ref.current?.zoomToFit(400, 40)}
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
