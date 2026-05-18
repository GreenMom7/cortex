"use client";
import { LLMConfigCard } from "./LLMConfigCard";
import { Neo4jConfigCard } from "./Neo4jConfigCard";
import { ChunkingCard } from "./ChunkingCard";
import { UploadCard } from "./UploadCard";
import { ProgressCard } from "./ProgressCard";

export function Sidebar({ onGraphRefresh }: { onGraphRefresh: () => void }) {
  return (
    <aside className="flex flex-col gap-3 overflow-y-auto pr-1">
      <LLMConfigCard />
      <Neo4jConfigCard onConnected={onGraphRefresh} />
      <ChunkingCard />
      <UploadCard />
      <ProgressCard onDone={onGraphRefresh} />
    </aside>
  );
}
