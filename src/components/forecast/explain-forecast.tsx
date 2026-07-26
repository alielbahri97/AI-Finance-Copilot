"use client";

import { useRef, useState } from "react";
import { Loader2Icon, SparklesIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/copilot/markdown";
import { Button } from "@/components/ui/button";

/**
 * Requests a streamed AI explanation of the current forecast and renders it
 * as markdown while tokens arrive.
 */
export function ExplainForecast() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function explain() {
    if (isStreaming) return;
    setIsStreaming(true);
    setContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/forecast/explain", {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        toast.error("Could not generate explanation", {
          description: body?.error ?? "Try again in a moment.",
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type: string; text?: string; message?: string };
            if (event.type === "delta" && event.text) {
              text += event.text;
              setContent(text);
            } else if (event.type === "error") {
              toast.error("Explanation failed", { description: event.message });
            }
          } catch {
            // Skip malformed lines.
          }
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Network error", { description: "Please try again." });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Let the AI walk through the drivers, risks and recommended actions behind these numbers.
        </p>
        {isStreaming ? (
          <Button size="sm" variant="outline" onClick={stop}>
            <SquareIcon className="fill-current" />
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={explain}>
            <SparklesIcon />
            {content ? "Regenerate" : "Explain this forecast"}
          </Button>
        )}
      </div>

      {isStreaming && content.length === 0 && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          Analyzing your forecast…
        </div>
      )}

      {content.length > 0 && (
        <div className="bg-muted/40 rounded-lg border p-4 text-sm">
          <Markdown content={content} />
        </div>
      )}
    </div>
  );
}
