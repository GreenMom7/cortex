"use client";
import { Network } from "lucide-react";
import { useEffect, useState } from "react";
import { api, SchemaResponse } from "@/lib/api";

const INFRA_LABELS = new Set(["Document", "Chunk"]);
const STRUCTURAL_RELS = new Set(["PART_OF", "NEXT_CHUNK", "HAS_ENTITY"]);

export function SchemaPanel({ refreshKey }: { refreshKey: number }) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    api.getSchema()
      .then(setSchema)
      .catch(() => setError(true));
  }, [refreshKey]);

  const empty = schema && schema.node_labels.length === 0 && schema.rel_types.length === 0;

  const infraLabels = schema?.node_labels.filter((i) => INFRA_LABELS.has(i.label)) ?? [];
  const entityLabels = schema?.node_labels.filter((i) => !INFRA_LABELS.has(i.label)) ?? [];
  const structuralRels = schema?.rel_types.filter((i) => STRUCTURAL_RELS.has(i.type)) ?? [];
  const knowledgeRels = schema?.rel_types.filter((i) => !STRUCTURAL_RELS.has(i.type)) ?? [];

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider flex items-center gap-2">
          <Network size={13} /> Graph schema
        </h3>
        {schema && (
          <span className="chip">
            {schema.node_labels.length + schema.rel_types.length}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {error && (
          <p className="font-mono text-xs text-muted">
            Connect Neo4j to see the graph schema.
          </p>
        )}
        {!error && empty && (
          <p className="font-mono text-xs text-muted">
            Graph is empty. Run the pipeline to populate the schema.
          </p>
        )}

        {infraLabels.length > 0 && (
          <LabelSection title="Infrastructure" items={infraLabels} />
        )}

        {entityLabels.length > 0 && (
          <LabelSection title="Entity types" items={entityLabels} />
        )}

        {structuralRels.length > 0 && (
          <RelSection title="Structural" items={structuralRels} />
        )}

        {knowledgeRels.length > 0 && (
          <RelSection title="Knowledge" items={knowledgeRels} />
        )}
      </div>
    </div>
  );
}

function LabelSection({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  return (
    <section>
      <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted mb-2">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="panel-soft flex items-center justify-between px-3 py-1.5 font-mono text-[0.72rem]"
          >
            <span>{item.label}</span>
            <span className="chip">{item.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RelSection({ title, items }: { title: string; items: { type: string; count: number }[] }) {
  return (
    <section>
      <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted mb-2">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.type}
            className="panel-soft flex items-center justify-between px-3 py-1.5 font-mono text-[0.72rem]"
          >
            <span className="text-accent">{item.type}</span>
            <span className="chip">{item.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
