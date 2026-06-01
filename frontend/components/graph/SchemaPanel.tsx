"use client";
import { Network } from "lucide-react";
import { useEffect, useState } from "react";
import { api, SchemaResponse } from "@/lib/api";

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

        {schema && schema.node_labels.length > 0 && (
          <section>
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted mb-2">
              Node labels
            </p>
            <div className="space-y-1">
              {schema.node_labels.map((item) => (
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
        )}

        {schema && schema.rel_types.length > 0 && (
          <section>
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted mb-2">
              Relationship types
            </p>
            <div className="space-y-1">
              {schema.rel_types.map((item) => (
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
        )}
      </div>
    </div>
  );
}
