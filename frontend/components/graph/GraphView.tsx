"use client";
import { useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import { Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut, Plus, AlertTriangle} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { api, type GraphEdge as MyEdge, type GraphNode as MyNode } from "@/lib/api";
import { toast } from "sonner";
import { useEffect } from "react";

// react-force-graph uses canvas/WebGL; must be client-only
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type Props = {
  nodes: MyNode[];
  edges: MyEdge[];
  highlightNodes?: string[];
  highlightEdges?: string[];
  onSelectNode?: (id: string | null) => void;
  selectedNode?: string | null;
  onChange?: () => void;
  onLimitChange?: (limit: number | "All") => void;
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

// Shape of the node/link objects we feed into react-force-graph.
// The library mutates these in place (x, y, vx, vy, fx, fy) while the
// simulation runs, which is what makes the Neo4j-style live drag work.
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
  size: number;
  fill: string;
};

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode, onChange, onLimitChange
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<ForceGraphMethods<RGNode, RGEdge> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
    for (const n of nodes) set.add(pickClass(n.labels));
    return Array.from(set).sort();
  }, [nodes]);

  const rgNodes: RGNode[] = useMemo(
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
          // Node radius in canvas px (pre-zoom). ~7 reads as a proper
          // bubble with the label sitting under it.
          size: isSel || isHi ? 9 : 7,
        } satisfies RGNode;
      }),
    [nodes, highlightNodes, selectedNode]
  );

  const rgEdges: RGEdge[] = useMemo(
    () =>
      edges.map((e) => {
        const isHi = highlightEdges.includes(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          size: isHi ? 2 : 1,
          fill: isHi ? "#1e9352" : theme === "dark" ? "#5a635c" : "#7a847e",
        } satisfies RGEdge;
      }),
    [edges, highlightEdges, theme]
  );

  // react-force-graph wants one { nodes, links } object. It mutates this
  // structure during simulation, so memoize on the same deps as above.
  const graphData = useMemo(
    () => ({ nodes: rgNodes, links: rgEdges }),
    [rgNodes, rgEdges]
  );

  // Same palette roles as the old reagraph theme object, kept as plain
  // values since react-force-graph styles via props + canvas callbacks.
  const themeObj = useMemo(
    () =>
      theme === "dark"
        ? {
            canvas: { background: "#161b18" },
            node: {
              label: { color: "#f5f7f5", stroke: "#0f1311" },
            },
            edge: {
              label: { color: "#e7ebe8", stroke: "#0f1311" },
            },
          }
        : {
            // Soft warm-paper background so dark edges + labels read clearly
            canvas: { background: "#ecefe9" },
            node: {
              label: { color: "#0d100e", stroke: "#ffffff" },
            },
            edge: {
              label: { color: "#1a201d", stroke: "#ffffff" },
            },
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
      const r = node.size;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.fill;
      ctx.fill();

      // Label under the bubble, with a stroke for readability
      const fontSize = Math.max(11 / globalScale, 2.5);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = fontSize / 4;
      ctx.strokeStyle = themeObj.node.label.stroke;
      ctx.strokeText(node.label, node.x!, node.y! + r + 2);
      ctx.fillStyle = themeObj.node.label.color;
      ctx.fillText(node.label, node.x!, node.y! + r + 2);
    },
    [themeObj]
  );

  // Pointer hit-area must match the drawn bubble + label
  const drawNodePointerArea = useCallback(
    (node: RGNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, node.size + 4, 0, 2 * Math.PI);
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
      const fontSize = Math.max(8 / globalScale, 2);
      ctx.font = `700 ${fontSize}px monospace`;
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
        nodeVal={(n: any) => n.size}
        // --- Edges ---
        linkColor={(l: any) => l.fill}
        linkWidth={(l: any) => l.size}
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
        <span className="chip">{nodes.length} nodes</span>{" "}
        <span className="chip">{edges.length} edges</span>
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

