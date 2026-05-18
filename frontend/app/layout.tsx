import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/lib/theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Cortex — Human-in-the-loop GraphRAG",
  description:
    "Build, edit and query knowledge graphs with LLMs. A control center for GraphRAG pipelines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--bg-elev)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "0.78rem",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
