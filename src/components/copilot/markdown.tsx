"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Assistant-message markdown with styling that matches the design system. */
export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="leading-relaxed [&:not(:first-child)]:mt-2.5">{children}</p>
        ),
        ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        a: ({ children, href }) =>
          // App-internal links navigate in place; external links open a tab.
          href?.startsWith("/") ? (
            <Link href={href} className="text-primary underline underline-offset-2">
              {children}
            </Link>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
        h1: ({ children }) => <h3 className="mt-3 text-base font-semibold">{children}</h3>,
        h2: ({ children }) => <h3 className="mt-3 text-base font-semibold">{children}</h3>,
        h3: ({ children }) => <h4 className="mt-3 text-sm font-semibold">{children}</h4>,
        blockquote: ({ children }) => (
          <blockquote className="border-border text-muted-foreground mt-2 border-l-2 pl-3 italic">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="bg-background/60 rounded px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre className="bg-background/60 mt-2 overflow-x-auto rounded-lg p-3 font-mono text-xs">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs sm:text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="text-left">{children}</thead>,
        th: ({ children }) => (
          <th className="border-border border-b px-2 py-1.5 font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border-border/60 border-b px-2 py-1.5 align-top">{children}</td>
        ),
        hr: () => <hr className="border-border my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
