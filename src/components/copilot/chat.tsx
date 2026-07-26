"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BotIcon, HistoryIcon, SendIcon, SquareIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/copilot/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatMessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

interface CopilotChatProps {
  conversationId: string | null;
  initialMessages: ChatMessageItem[];
  suggestions: string[];
  onOpenHistory?: () => void;
}

type StreamEvent =
  | { type: "meta"; conversationId: string; title: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function CopilotChat({
  conversationId,
  initialMessages,
  suggestions,
  onOpenHistory,
}: CopilotChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(conversationId);
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

  // Abort any in-flight stream when the component unmounts.
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
    const wasNewConversation = activeIdRef.current === null;
    let failed = false;

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversationId: activeIdRef.current ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        toast.error("Copilot error", {
          description: body?.error ?? "The assistant could not answer. Try again.",
        });
        failed = true;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "meta") {
          activeIdRef.current = event.conversationId;
        } else if (event.type === "delta") {
          updateAssistant(assistantId, (content) => content + event.text);
          scrollToBottom("auto");
        } else if (event.type === "error") {
          toast.error("Copilot error", { description: event.message });
          failed = true;
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
        failed = true;
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Drop the empty assistant bubble if nothing arrived.
      setMessages((prev) =>
        prev.filter((message) => !(message.id === assistantId && message.content === ""))
      );
      if (!failed) {
        if (wasNewConversation && activeIdRef.current) {
          router.replace(`/copilot?c=${activeIdRef.current}`, { scroll: false });
        }
        router.refresh();
      }
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const askedQuestions = new Set(
    messages.filter((message) => message.role === "USER").map((message) => message.content)
  );
  const followUpChips = suggestions
    .filter((suggestion) => !askedQuestions.has(suggestion))
    .slice(0, 3);

  const isEmpty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  const showTypingDots =
    isStreaming && lastMessage?.role === "ASSISTANT" && lastMessage.content === "";

  return (
    <div className="bg-card flex h-full min-h-0 flex-col rounded-xl border shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <BotIcon className="size-4" />
          </div>
          Finance Copilot
        </div>
        {onOpenHistory && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground lg:hidden"
            onClick={onOpenHistory}
          >
            <HistoryIcon />
            History
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto p-4"
      >
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-full">
              <BotIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">Ask me anything about your finances</p>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                I can see your transactions, categories, balances, trends and forecasts — and
                I answer with your real numbers.
              </p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {suggestions.slice(0, 5).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => sendMessage(suggestion)}
                  className="bg-muted hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex items-start gap-3",
                message.role === "USER" && "flex-row-reverse"
              )}
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  message.role === "USER"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {message.role === "USER" ? (
                  <UserIcon className="size-4" />
                ) : (
                  <BotIcon className="size-4" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-2.5 text-sm",
                  message.role === "USER"
                    ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                    : "bg-muted rounded-tl-sm"
                )}
              >
                {message.role === "ASSISTANT" ? (
                  message.content === "" && showTypingDots ? (
                    <span className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
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

      {!isEmpty && !isStreaming && followUpChips.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {followUpChips.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => sendMessage(suggestion)}
              className="bg-muted hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-full px-3 py-1 text-xs transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t p-3"
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
          placeholder="Ask about your cash, suppliers, forecasts…"
          className="max-h-32 min-h-10 resize-none"
          rows={1}
          disabled={isStreaming}
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
