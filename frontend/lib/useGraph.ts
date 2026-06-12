"use client";
import { useCallback, useEffect, useState } from "react";
import { api, GraphEdge, GraphNode } from "./api";

export function useGraph(limit: number | "All" = 250) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await api.getGraph(limit);
      setNodes(g.nodes);
      setEdges(g.edges);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { nodes, edges, loading, error, refresh };
}
