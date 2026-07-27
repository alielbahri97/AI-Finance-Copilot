"use client";

import dynamic from "next/dynamic";

/**
 * Lazy markdown renderer: react-markdown + remark-gfm are only fetched when
 * an assistant message actually renders, keeping them out of the initial
 * copilot/forecast JS.
 */
export const Markdown = dynamic(() => import("./markdown").then((m) => m.Markdown), {
  ssr: false,
  loading: function MarkdownFallback() {
    return <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />;
  },
});
