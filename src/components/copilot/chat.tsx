"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Markdown } from "@/components/copilot/markdown-lazy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatMessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt?: string;
}

interface CopilotChatProps {
  conversationId: string | null;
  initialMessages: ChatMessageItem[];
  suggestions: string[];
  /** Plan gating: monthly AI message quota is used up. */
  quotaExhausted?: boolean;
  onOpenHistory?: () => void;
}

type StreamEvent =
  | { type: "meta"; conversationId: string; title: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** A turn that never produced an answer, kept so the user can re-send it. */
interface FailedTurn {
  prompt: string;
  message: string;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export function CopilotChat({
  conversationId,
  initialMessages,
  suggestions,
  quotaExhausted = false,
  onOpenHistory,
}: CopilotChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = nearBottom;
    setIsAtBottom(nearBottom);
  }

  function jumpToLatest() {
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    scrollToBottom();
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
    if (!trimmed || isStreaming || quotaExhausted) return;

    // A retry or a chip must not wipe whatever the user has half-typed.
    setInput((current) => (current.trim() === trimmed ? "" : current));
    setFailedTurn(null);
    setIsStreaming(true);
    stickToBottomRef.current = true;
    setIsAtBottom(true);

    const sentAt = new Date().toISOString();
    const assistantId = `local-${Date.now()}-assistant`;
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}-user`, role: "USER", content: trimmed, createdAt: sentAt },
      { id: assistantId, role: "ASSISTANT", content: "", createdAt: sentAt },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const wasNewConversation = activeIdRef.current === null;
    let failure: string | null = null;

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
        failure = body?.error ?? "The assistant could not answer that one.";
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
          failure = event.message;
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
        failure = "Could not reach the assistant. Check your connection.";
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Drop the empty assistant bubble if nothing arrived.
      setMessages((prev) =>
        prev.filter((message) => !(message.id === assistantId && message.content === ""))
      );
      if (failure) {
        setFailedTurn({ prompt: trimmed, message: failure });
      } else {
        if (wasNewConversation && activeIdRef.current) {
          router.replace(`/copilot?c=${activeIdRef.current}`, { scroll: false });
        }
        router.refresh();
      }
      // Buttons that triggered the turn can disappear on completion, which drops
      // focus to the document.
      if (document.activeElement === document.body) inputRef.current?.focus();
    }
  }

  /** Rewinds to just before `prompt` was asked and sends it again. */
  function resend(prompt: string) {
    if (isStreaming || quotaExhausted) return;
    setFailedTurn(null);
    setMessages((prev) => {
      let end = prev.length;
      while (end > 0 && prev[end - 1]?.role === "ASSISTANT") end -= 1;
      if (end > 0 && prev[end - 1]?.content === prompt) end -= 1;
      return prev.slice(0, end);
    });
    void sendMessage(prompt);
  }

  async function copyMessage(message: ChatMessageItem) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === message.id ? null : current)),
        1500
      );
    } catch {
      toast.error("Could not copy", { description: "Your browser blocked clipboard access." });
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
  const lastPrompt = [...messages].reverse().find((message) => message.role === "USER")?.content;

  return (
    <div className="bg-card flex h-full min-h-0 flex-col rounded-2xl border border-border/60 shadow-xs">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-xl">
            <BotIcon className="size-4" />
          </div>
          Copilot
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

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation"
          className="flex-1 space-y-4 overflow-y-auto p-4"
        >
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-2 text-center">
              <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
                <BotIcon className="size-7" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-semibold tracking-tight">Ask about your money</p>
                <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
                  Balances, spending, trends and forecasts — answered with your real numbers.
                </p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {suggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    className="bg-muted hover:bg-accent hover:text-accent-foreground cursor-pointer rounded-full px-3.5 py-2 text-xs transition-colors duration-150"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const isAssistant = message.role === "ASSISTANT";
              const isLast = index === messages.length - 1;
              const isPending = isAssistant && message.content === "" && showTypingDots;
              const showActions = isAssistant && !isPending && !(isStreaming && isLast);
              return (
                <div
                  key={message.id}
                  className={cn("flex items-start gap-3", !isAssistant && "flex-row-reverse")}
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      isAssistant
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                    )}
                  >
                    {isAssistant ? (
                      <BotIcon className="size-4" />
                    ) : (
                      <UserIcon className="size-4" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "flex min-w-0 max-w-[85%] flex-col gap-1",
                      !isAssistant && "items-end"
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-xl px-4 py-2.5 text-sm",
                        isAssistant
                          ? "bg-muted rounded-tl-sm"
                          : "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                      )}
                    >
                      {isAssistant ? (
                        isPending ? (
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
                    {showActions && (
                      <div className="text-muted-foreground flex items-center gap-1 pl-1">
                        {message.createdAt && (
                          <time
                            className="text-xs tabular-nums"
                            dateTime={message.createdAt}
                            suppressHydrationWarning
                          >
                            {TIME_FORMAT.format(new Date(message.createdAt))}
                          </time>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground size-6"
                          onClick={() => copyMessage(message)}
                        >
                          {copiedId === message.id ? (
                            <CheckIcon className="size-3.5" />
                          ) : (
                            <CopyIcon className="size-3.5" />
                          )}
                          <span className="sr-only">Copy answer</span>
                        </Button>
                        {isLast && !failedTurn && lastPrompt && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground size-6"
                            disabled={quotaExhausted}
                            onClick={() => resend(lastPrompt)}
                          >
                            <RefreshCwIcon className="size-3.5" />
                            <span className="sr-only">Regenerate answer</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {failedTurn && (
            <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
              <p className="text-destructive flex items-center gap-2 text-sm">
                <TriangleAlertIcon className="size-4 shrink-0" />
                {failedTurn.message}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isStreaming || quotaExhausted}
                onClick={() => resend(failedTurn.prompt)}
              >
                <RefreshCwIcon />
                Retry
              </Button>
            </div>
          )}
        </div>

        {!isEmpty && !isAtBottom && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={jumpToLatest}
            className="bg-card absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full shadow-md"
          >
            <ArrowDownIcon />
            Jump to latest
          </Button>
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

      {quotaExhausted && (
        <div className="bg-muted/60 mx-3 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            You have used this month&apos;s AI messages on your current plan.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing">Upgrade</Link>
          </Button>
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
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder={
            quotaExhausted
              ? "Monthly AI message limit reached"
              : "Ask about your cash, suppliers, forecasts…"
          }
          className={cn("max-h-32 min-h-10 resize-none", isStreaming && "opacity-70")}
          rows={1}
          // Streaming keeps the caret here: a disabled textarea blurs and drops
          // keyboard users back to the top of the page after every answer.
          readOnly={isStreaming}
          aria-busy={isStreaming}
          disabled={quotaExhausted}
        />
        {isStreaming ? (
          <Button type="button" size="icon" variant="outline" onClick={stopStreaming}>
            <SquareIcon className="fill-current" />
            <span className="sr-only">Stop generating</span>
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={input.trim().length === 0 || quotaExhausted}
          >
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        )}
      </form>
    </div>
  );
}
