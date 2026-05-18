"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type Progress = {
  stage: "idle" | "loading" | "chunking" | "extracting" | "ingesting" | "done";
  chunks_total: number;
  chunks_processed: number;
  triples_extracted: number;
  triples_ingested: number;
  message: string;
};

const initial: Progress = {
  stage: "idle",
  chunks_total: 0,
  chunks_processed: 0,
  triples_extracted: 0,
  triples_ingested: 0,
  message: "",
};

const ACTIVE = new Set<Progress["stage"]>(["loading", "chunking", "extracting", "ingesting"]);

/**
 * Streams pipeline progress via SSE, with an HTTP polling fallback in case
 * the EventSource never lands (proxy buffering, dev-server quirks, etc.).
 * Calls `onDone` once each time the pipeline transitions into "done".
 */
export function useProgress(onDone?: () => void) {
  const [progress, setProgress] = useState<Progress>(initial);
  const lastStageRef = useRef<Progress["stage"]>("idle");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || "";
    let stopped = false;
    let sseAlive = false;

    const apply = (next: Progress) => {
      setProgress(next);
      const prev = lastStageRef.current;
      lastStageRef.current = next.stage;
      if (next.stage === "done" && prev !== "done") onDoneRef.current?.();
    };

    // --- SSE primary ---
    const es = new EventSource(`${base}/api/pipeline/progress`);
    es.addEventListener("open", () => { sseAlive = true; });
    es.addEventListener("progress", (e: MessageEvent) => {
      sseAlive = true;
      try { apply(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("error", () => { sseAlive = false; });

    // --- Polling fallback ---
    // Runs only while pipeline is active OR SSE looks dead. ~1s cadence is plenty.
    const poll = async () => {
      if (stopped) return;
      const active = ACTIVE.has(lastStageRef.current);
      if (!sseAlive || active) {
        try {
          const snap = await api.getProgress();
          apply(snap);
        } catch { /* swallow */ }
      }
    };
    const id = window.setInterval(poll, 1000);

    return () => {
      stopped = true;
      window.clearInterval(id);
      es.close();
    };
  }, []);

  return progress;
}
