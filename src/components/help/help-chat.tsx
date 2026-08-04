"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LifeBuoyIcon, SendIcon, SquareIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/copilot/markdown-lazy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface HelpMessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

/** Featured questions, mirrored on /help and in the floating panel. */
export const COMMON_QUESTIONS = [
  "How do I connect my bank?",
  "How do I import a CSV?",
  "How do forecasts work?",
  "What does my plan include?",
  "How do I set up notifications?",
];

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

interface HelpChatProps {
  initialMessages: HelpMessageItem[];
  /** Compact styling for the floating panel. */
  compact?: boolean;
  className?: string;
}

/**
 * The help-agent chat. Unlike the finance copilot this is a single thread,
 * is never plan-gated, and answers "how do I…" questions about the app.
 */
export function HelpChat({ initialMessages, compact = false, className }: HelpChatProps) {
  const [messages, setMessages] = useState<HelpMessageItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }, []);

  useEffect(() => {
    scrollToBottom("auto");
  }, [messages, scrollToBottom]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function updateAssistant(id: string, updater: (content: string) => string) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id ? { ...message, content: updater(message.content) } : message
      )
    );
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    stickToBottomRef.current = true;

    const assistantId = `local-${Date.now()}-assistant`;
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}-user`, role: "USER", content: trimmed },
      { id: assistantId, role: "ASSISTANT", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        toast.error("Help assistant error", {
          description: body?.error ?? "Could not answer right now. Try again.",
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "delta") {
          updateAssistant(assistantId, (content) => content + event.text);
          scrollToBottom("auto");
        } else if (event.type === "error") {
          toast.error("Help assistant error", { description: event.message });
        }
      };

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
            handleEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // Skip malformed lines.
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        toast.error("Network error", { description: "Please try again." });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.filter((message) => !(message.id === assistantId && message.content === ""))
      );
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const isEmpty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  const showTypingDots =
    isStreaming && lastMessage?.role === "ASSISTANT" && lastMessage.content === "";
  const askedQuestions = new Set(
    messages.filter((message) => message.role === "USER").map((message) => message.content)
  );
  const followUps = COMMON_QUESTIONS.filter((question) => !askedQuestions.has(question));

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn("flex-1 space-y-4 overflow-y-auto", compact ? "p-3" : "p-4")}
      >
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-full">
              <LifeBuoyIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">How can I help you use FinPilot?</p>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Ask me how to do anything in the app — connecting banks, imports, forecasts,
                invoices, notifications, billing…
              </p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {COMMON_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => sendMessage(question)}
                  className="bg-muted hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex items-start gap-2.5",
                message.role === "USER" && "flex-row-reverse"
              )}
            >
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  message.role === "USER"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-accent text-accent-foreground"
                )}
              >
                {message.role === "USER" ? (
                  <UserIcon className="size-3.5" />
                ) : (
                  <LifeBuoyIcon className="size-3.5" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[88%] rounded-xl px-3.5 py-2 text-sm",
                  message.role === "USER"
                    ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                    : "bg-muted rounded-tl-sm"
                )}
              >
                {message.role === "ASSISTANT" ? (
                  message.content === "" && showTypingDots ? (
                    <span
                      className="flex items-center gap-1 py-1"
                      aria-label="Assistant is typing"
                    >
                      <span className="bg-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
                      <span className="bg-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
                      <span className="bg-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <Markdown content={message.content} />
                  )
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {!isEmpty && !isStreaming && followUps.length > 0 && (
        <div className={cn("flex flex-wrap gap-2 pb-2", compact ? "px-3" : "px-4")}>
          {followUps.slice(0, compact ? 2 : 3).map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => sendMessage(question)}
              className="bg-muted hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-full px-3 py-1 text-xs transition-colors"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <form
        className={cn("flex items-end gap-2 border-t", compact ? "p-2.5" : "p-3")}
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="How do I…?"
          className="max-h-28 min-h-10 resize-none"
          rows={1}
          disabled={isStreaming}
          aria-label="Ask the help assistant"
        />
        {isStreaming ? (
          <Button type="button" size="icon" variant="outline" onClick={stopStreaming}>
            <SquareIcon className="fill-current" />
            <span className="sr-only">Stop generating</span>
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={input.trim().length === 0}>
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        )}
      </form>
    </div>
  );
}
