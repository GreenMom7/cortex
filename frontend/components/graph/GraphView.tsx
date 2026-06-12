"use client";
import { useMemo, useRef, useState} from "react";
import dynamic from "next/dynamic";
import type { GraphCanvasRef, GraphEdge, GraphNode } from "reagraph";
import { Maximize2, Minimize2, RotateCw, ZoomIn, ZoomOut, Plus, AlertTriangle} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { api, type GraphEdge as MyEdge, type GraphNode as MyNode } from "@/lib/api";
import { toast } from "sonner";
import { useEffect } from "react";

// reagraph uses WebGL; must be client-only
const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

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

export function GraphView({
  nodes, edges, highlightNodes = [], highlightEdges = [],
  onSelectNode, selectedNode, onChange, onLimitChange
}: Props) {
  const { theme } = useTheme();
  const ref = useRef<GraphCanvasRef | null>(null);

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [limit, setLimit] = useState<number | "All">(250);

  const handleLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const newLimit = val === "All" ? "All" : parseInt(val, 10);
    setLimit(newLimit);
    onLimitChange?.(newLimit); // Tell parent to refetch with new limit
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
            <option value={250}>250 (Small)</option>
            <option value={500}>500 (Medium)</option>
            <option value={1000}>1000 (Large)</option>
            <option value="All">All (Unlimited)</option>
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
