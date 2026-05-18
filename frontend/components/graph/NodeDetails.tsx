"use client";
import { Trash2, Save, GitMerge, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, GraphNode, GraphEdge } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  node: GraphNode | null;
  nodes: GraphNode[];           // for the merge / add-relation pickers
  edges: GraphEdge[];
  onChange: () => void;          // ask the parent to refetch the graph
  onClose: () => void;
};

export function NodeDetails({ node, nodes, edges, onChange, onClose }: Props) {
  const [props, setProps] = useState<Record<string, any>>({});
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (node) {
      setProps({ ...node.data });
      setLabel(node.labels[0] || "Entity");
    }
  }, [node]);

  if (!node) {
    return (
      <div className="panel p-6">
        <p className="font-mono text-xs text-muted">
          Click a node on the graph to inspect or edit it.
        </p>
      </div>
    );
  }

  const incoming = edges.filter((e) => e.target === node.id);
  const outgoing = edges.filter((e) => e.source === node.id);

  async function save() {
    try {
      await api.updateNode(node!.id, props, label);
      toast.success("Node saved");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function del() {
    if (!confirm(`Delete node "${node!.label}"?`)) return;
    try {
      await api.deleteNode(node!.id);
      toast.success("Node deleted");
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function merge() {
    const targetId = prompt("Merge INTO which node ID? (find it in the node list)");
    if (!targetId) return;
    try {
      await api.mergeNodes(node!.id, targetId);
      toast.success("Merged");
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function addRel() {
    const targetId = prompt("Target node ID?");
    const rel = prompt("Relationship name (e.g. WORKS_FOR)?");
    if (!targetId || !rel) return;
    try {
      await api.addRelation(node!.id, targetId, rel.toUpperCase().replace(/\s+/g, "_"));
      toast.success("Relation added");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="panel flex flex-col h-full overflow-hidden animate-slide-up">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <div className="label !mb-0">Selected node</div>
          <h3 className="font-mono text-sm font-semibold truncate">{node.label}</h3>
        </div>
        <button onClick={onClose} className="btn btn-ghost !text-[0.7rem]">close</button>
      </div>

      <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">
        <div>
          <label className="label">Class / label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div>
          <label className="label">Properties</label>
          <div className="space-y-2">
            {Object.entries(props).map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <input
                  className="input !w-1/3"
                  value={k}
                  onChange={(e) => {
                    const newProps: Record<string, any> = {};
                    Object.entries(props).forEach(([oldK, oldV]) => {
                      newProps[oldK === k ? e.target.value : oldK] = oldV;
                    });
                    setProps(newProps);
                  }}
                />
                <input
                  className="input !flex-1"
                  value={String(v)}
                  onChange={(e) => setProps({ ...props, [k]: e.target.value })}
                />
              </div>
            ))}
            <button
              onClick={() => setProps({ ...props, [""]: "" })}
              className="btn btn-ghost !text-[0.7rem]"
            >
              <Plus size={12} /> Add property
            </button>
          </div>
        </div>

        <div>
          <label className="label">Relationships</label>
          <div className="font-mono text-[0.72rem] space-y-1">
            {outgoing.length === 0 && incoming.length === 0 && (
              <span className="text-muted">No relationships.</span>
            )}
            {outgoing.map((e) => (
              <div key={e.id} className="flex items-center gap-1 text-muted">
                <span className="text-accent">→</span>
                <span className="font-semibold">{e.label}</span>
                <span className="truncate">{nodes.find((n) => n.id === e.target)?.label ?? "?"}</span>
                <button
                  className="btn btn-ghost ml-auto !p-1"
                  onClick={async () => {
                    await api.deleteRelation(e.id);
                    toast.success("Relation removed");
                    onChange();
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {incoming.map((e) => (
              <div key={e.id} className="flex items-center gap-1 text-muted">
                <span className="text-muted">←</span>
                <span className="font-semibold">{e.label}</span>
                <span className="truncate">{nodes.find((n) => n.id === e.source)?.label ?? "?"}</span>
                <button
                  className="btn btn-ghost ml-auto !p-1"
                  onClick={async () => {
                    await api.deleteRelation(e.id);
                    toast.success("Relation removed");
                    onChange();
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t grid grid-cols-2 gap-2">
        <button onClick={save} className="btn btn-primary col-span-2">
          <Save size={13} /> Save changes
        </button>
        <button onClick={addRel} className="btn">
          <Plus size={13} /> Relate
        </button>
        <button onClick={merge} className="btn">
          <GitMerge size={13} /> Merge
        </button>
        <button onClick={del} className="btn col-span-2" style={{ color: "var(--danger)" }}>
          <Trash2 size={13} /> Delete node
        </button>
      </div>
    </div>
  );
}
