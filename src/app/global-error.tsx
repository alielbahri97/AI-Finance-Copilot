"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself,
 * where the regular error.tsx cannot render. Must provide its own <html>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100svh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "1rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#666", margin: "0.75rem 0 1.25rem" }}>
            An unexpected error occurred. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #ccc",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href={`mailto:support@finpilot.app?subject=${encodeURIComponent("FinPilot issue report")}&body=${encodeURIComponent(
              `Page: ${typeof window !== "undefined" ? window.location.href : "unknown"}\nError: ${error.message}\nReference: ${error.digest ?? "n/a"}`
            )}`}
            style={{
              display: "inline-block",
              marginTop: "0.75rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #ccc",
              color: "#111",
              textDecoration: "none",
            }}
          >
            Report issue
          </a>
        </div>
      </body>
    </html>
  );
}
