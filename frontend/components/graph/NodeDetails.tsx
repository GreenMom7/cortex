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
import { createPortal } from "react-dom";
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
  position: "top-center" as const,
  style: {
    background: "var(--bg-elev)",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    boxShadow: "none",
  },
};

/** Centered, dismissible modal rendered to <body> so ancestor transforms can't clip it. */
function Modal({
  title,
  icon,
  children,
  confirmLabel,
  confirmColor = "var(--accent)",
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmColor?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md rounded-lg p-5 animate-slide-up"
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h3 className="font-mono text-sm font-semibold">{title}</h3>
        </div>
        {children && <div className="mb-4 space-y-1.5">{children}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn"
            disabled={busy}
            style={{ color: confirmColor, borderColor: confirmColor }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function NodeDetails({ node, nodes, edges, onChange, onClose }: Props) {
  const [rows, setRows] = useState<PropRow[]>([]);
  const [label, setLabel] = useState("");
  const [dialog, setDialog] = useState<null | "delete" | "merge" | "relate">(null);
  const [mergeId, setMergeId] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relName, setRelName] = useState("");
  const [busy, setBusy] = useState(false);

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

  const layer = node.data?._layer || (
    node.labels.includes("Document") ? "document" :
    node.labels.includes("Chunk") ? "chunk" : "entity"
  );

  if (layer === "document" || layer === "chunk") {
    return (
      <div className="panel flex flex-col h-full overflow-hidden animate-slide-up">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="label !mb-0 capitalize">{layer} node</div>
            <h3 className="font-mono text-sm font-semibold truncate">{node.label}</h3>
          </div>
          <button onClick={onClose} className="btn btn-ghost !text-[0.7rem]">close</button>
        </div>
        <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1">
          {layer === "document" && (
            <>
              <ReadOnlyField label="File name" value={node.data.fileName} />
              <ReadOnlyField label="Source" value={node.data.fileSource} />
              <ReadOnlyField label="Type" value={node.data.fileType} />
            </>
          )}
          {layer === "chunk" && (
            <>
              <ReadOnlyField label="Chunk ID" value={node.data.chunkId} />
              <ReadOnlyField label="Position" value={String(node.data.position ?? "")} />
              <div>
                <label className="label">Text preview</label>
                <p className="font-mono text-[0.72rem] panel-soft px-3 py-2 rounded whitespace-pre-wrap">
                  {node.data.text || "(empty)"}
                </p>
              </div>
            </>
          )}
          <div>
            <label className="label">Labels</label>
            <div className="flex flex-wrap gap-1">
              {node.labels.map((l) => (
                <span key={l} className="chip">{l}</span>
              ))}
            </div>
          </div>
        </div>
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
  function del() {
    setDialog("delete");
  }
  function merge() {
    setMergeId("");
    setDialog("merge");
  }
  function addRel() {
    setRelTarget("");
    setRelName("");
    setDialog("relate");
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.deleteNode(node!.id);
      toast("Node deleted", {
        ...themedToast,
        icon: <Trash2 size={13} style={{ color: "var(--danger)" }} />,
      });
      setDialog(null);
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmMerge() {
    if (!mergeId.trim()) return;
    setBusy(true);
    try {
      await api.mergeNodes(node!.id, mergeId.trim());
      toast("Nodes merged", {
        ...themedToast,
        icon: <GitMerge size={13} style={{ color: "var(--accent)" }} />,
      });
      setDialog(null);
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRelate() {
    if (!relTarget.trim() || !relName.trim()) return;
    setBusy(true);
    try {
      await api.addRelation(
        node!.id,
        relTarget.trim(),
        relName.toUpperCase().replace(/\s+/g, "_"),
      );
      toast.success("Relation added");
      setDialog(null);
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
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

      {dialog === "delete" && (
        <Modal
          title={`Delete node "${node.label}"?`}
          icon={<Trash2 size={16} style={{ color: "var(--danger)" }} />}
          confirmLabel="Delete"
          confirmColor="var(--danger)"
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDialog(null)}
        >
          <p className="font-mono text-xs text-muted">
            Removes the node and all of its relationships. This can’t be undone.
          </p>
        </Modal>
      )}

      {dialog === "merge" && (
        <Modal
          title="Merge node"
          icon={<GitMerge size={16} style={{ color: "var(--accent)" }} />}
          confirmLabel="Merge"
          busy={busy}
          onConfirm={confirmMerge}
          onClose={() => setDialog(null)}
        >
          <label className="label">Merge into node ID</label>
          <input
            autoFocus
            className="input"
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmMerge()}
            placeholder="Paste the target node ID…"
          />
        </Modal>
      )}

      {dialog === "relate" && (
        <Modal
          title="Relate to another node"
          icon={<Plus size={16} style={{ color: "var(--accent)" }} />}
          confirmLabel="Add relation"
          busy={busy}
          onConfirm={confirmRelate}
          onClose={() => setDialog(null)}
        >
          <label className="label">Target node ID</label>
          <input
            autoFocus
            className="input"
            value={relTarget}
            onChange={(e) => setRelTarget(e.target.value)}
            placeholder="Paste the target node ID…"
          />
          <label className="label" style={{ marginTop: 8 }}>
            Relationship
          </label>
          <input
            className="input"
            value={relName}
            onChange={(e) => setRelName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmRelate()}
            placeholder="e.g. WORKS_FOR"
          />
        </Modal>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <code className="font-mono text-[0.72rem] panel-soft px-2 py-1.5 rounded block truncate select-all normal-case tracking-normal">
        {value || "—"}
      </code>
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
