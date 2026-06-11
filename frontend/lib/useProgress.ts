"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type Progress = {
  stage: "idle" | "loading" | "chunking" | "persisting" | "extracting" | "ingesting" | "done";
  chunks_total: number;
  chunks_processed: number;
  chunks_persisted?: number;
  chunks_failed?: number;
  triples_extracted: number;
  triples_ingested: number;
  message: string;
};

const initial: Progress = {
  stage: "idle",
  chunks_total: 0,
  chunks_processed: 0,
  chunks_failed: 0,
  triples_extracted: 0,
  triples_ingested: 0,
  message: "",
};

/**
 * Streams pipeline progress. Polls /progress/snapshot every 1s as the source
 * of truth (the endpoint is tiny — just reads a dict). SSE rides alongside
 * for sub-second updates when it works. Either feed calls onDone() exactly
 * once per "done" transition.
 */
export function useProgress(onDone?: () => void) {
  const [progress, setProgress] = useState<Progress>(initial);
  const lastStageRef = useRef<Progress["stage"]>("idle");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || "";
    let stopped = false;

    const apply = (next: Progress) => {
      setProgress(next);
      const prev = lastStageRef.current;
      lastStageRef.current = next.stage;
      if (next.stage === "done" && prev !== "done") onDoneRef.current?.();
    };

    // --- SSE (best-effort) ---
    const es = new EventSource(`${base}/api/pipeline/progress`);
    es.addEventListener("progress", (e: MessageEvent) => {
      try { apply(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener("error", () => { /* polling will carry us */ });

    // --- Polling (always on) ---
    const poll = async () => {
      if (stopped) return;
      try {
        const snap = await api.getProgress();
        apply(snap);
      } catch { /* swallow */ }
    };
    poll(); // immediate first read so the UI hydrates on mount
    const id = window.setInterval(poll, 1000);

    return () => {
      stopped = true;
      window.clearInterval(id);
      es.close();
    };
  }, []);

  return progress;
}
