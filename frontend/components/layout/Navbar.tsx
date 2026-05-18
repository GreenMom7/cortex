"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function Navbar() {
  const { theme, toggle } = useTheme();

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-6 py-3 border-b backdrop-blur-md"
      style={{ background: "color-mix(in srgb, var(--bg) 80%, transparent)" }}
    >
      <div className="flex items-center gap-3">
        <span className="brand-mark" aria-hidden />
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[1.05rem] font-semibold tracking-tight">
            senak
          </span>
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-muted">
            /human-in-the-loop graphRAG
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex chip font-mono">v0.1</span>
        <button
          onClick={toggle}
          className="btn btn-ghost"
          aria-label="Toggle theme"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span className="hidden md:inline">
            {theme === "dark" ? "Light" : "Dark"}
          </span>
        </button>
      </div>
    </header>
  );
}
