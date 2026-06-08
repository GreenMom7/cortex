"use client";
import {
  Trash2,
  Save,
  GitMerge,
  Plus,
  Copy,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, GraphNode, GraphEdge } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  node: GraphNode | null;
  nodes: GraphNode[]; // for the merge / add-relation pickers
  edges: GraphEdge[];
  onChange: () => void; // ask the parent to refetch the graph
  onClose: () => void;
};

type PropRow = { id: string; key: string; value: string };

const themedToast = {
  duration: 2500,
  style: {
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    boxShadow: "none",
  },
};

export function NodeDetails({ node, nodes, edges, onChange, onClose }: Props) {
  const [rows, setRows] = useState<PropRow[]>([]);
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (node) {
      setRows(
        Object.entries(node.data).map(([k, v]) => ({
          id: crypto.randomUUID(),
          key: k,
          value: String(v),
        })),
      );
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
    const props: Record<string, any> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k) props[k] = r.value;
    }
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
    const targetId = prompt(
      "Merge INTO which node ID? (find it in the node list)",
    );
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
      await api.addRelation(
        node!.id,
        targetId,
        rel.toUpperCase().replace(/\s+/g, "_"),
      );
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
          <h3 className="font-mono text-sm font-semibold truncate">
            {node.label}
          </h3>
        </div>
        <button onClick={onClose} className="btn btn-ghost !text-[0.7rem]">
          close
        </button>
      </div>

      <div className="px-4 py-3 space-y-4 overflow-y-auto flex-1">
        <div>
          <label className="label">Node ID</label>
          <div className="flex items-center gap-1">
            <code
              className="font-mono text-[0.72rem] panel-soft px-2 py-1.5 rounded flex-1 truncate select-all normal-case tracking-normal"
              title={node.id}
            >
              {node.id}
            </code>
            <button
              className="btn btn-ghost !p-2 shrink-0"
              title="Copy ID"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(node.id);
                  toast.success("Node ID copied");
                } catch {
                  toast.error("Could not copy");
                }
              }}
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <div>
          <label className="label">Class / label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Properties</label>
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex gap-1">
                <input
                  className="input !w-1/3"
                  value={row.key}
                  onChange={(e) =>
                    setRows(
                      rows.map((r) =>
                        r.id === row.id ? { ...r, key: e.target.value } : r,
                      ),
                    )
                  }
                />
                <input
                  className="input !flex-1"
                  value={row.value}
                  onChange={(e) =>
                    setRows(
                      rows.map((r) =>
                        r.id === row.id ? { ...r, value: e.target.value } : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <button
              onClick={() =>
                setRows([
                  ...rows,
                  { id: crypto.randomUUID(), key: "", value: "" },
                ])
              }
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
              <RelationRow
                key={e.id}
                edge={e}
                direction="out"
                otherLabel={nodes.find((n) => n.id === e.target)?.label ?? "?"}
                onChange={onChange}
              />
            ))}
            {incoming.map((e) => (
              <RelationRow
                key={e.id}
                edge={e}
                direction="in"
                otherLabel={nodes.find((n) => n.id === e.source)?.label ?? "?"}
                onChange={onChange}
              />
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
        <button
          onClick={del}
          className="btn col-span-2"
          style={{ color: "var(--danger)" }}
        >
          <Trash2 size={13} /> Delete node
        </button>
      </div>
    </div>
  );
}

function RelationRow({
  edge,
  direction,
  otherLabel,
  onChange,
}: {
  edge: GraphEdge;
  direction: "in" | "out";
  otherLabel: string;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(edge.label);
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = draft.trim().toUpperCase().replace(/\s+/g, "_");
    if (!next) {
      toast.error("Relation name required");
      return;
    }
    if (next === edge.label) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.updateRelation(edge.id, next);
      toast.success("Relation renamed");
      setEditing(false);
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteRelation(edge.id);
      toast.success("Relation removed");
      onChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const arrow =
    direction === "out" ? (
      <span className="text-accent">→</span>
    ) : (
      <span className="text-muted">←</span>
    );

  return (
    <div className="flex items-center gap-1 text-muted">
      {arrow}
      {editing ? (
        <input
          autoFocus
          className="input !py-0.5 !px-1.5 !text-[0.72rem] !w-auto flex-1 min-w-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(edge.label);
              setEditing(false);
            }
          }}
          disabled={busy}
        />
      ) : (
        <span className="font-semibold">{edge.label}</span>
      )}
      <span className="truncate">{otherLabel}</span>
      {editing ? (
        <>
          <button
            className="btn btn-ghost ml-auto !p-1"
            title="Save"
            disabled={busy}
            onClick={save}
          >
            <Check size={11} />
          </button>
          <button
            className="btn btn-ghost !p-1"
            title="Cancel"
            disabled={busy}
            onClick={() => {
              setDraft(edge.label);
              setEditing(false);
            }}
          >
            <X size={11} />
          </button>
        </>
      ) : (
        <>
          <button
            className="btn btn-ghost ml-auto !p-1"
            title="Rename"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil size={11} />
          </button>
          <button
            className="btn btn-ghost !p-1"
            title="Delete"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}
