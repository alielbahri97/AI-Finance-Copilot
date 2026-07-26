"use client";

import { useEffect, useRef, useState } from "react";
import { BotIcon, Loader2Icon, SendIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChatMessageItem {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

const SUGGESTIONS = [
  "How much did I spend on dining last month?",
  "What is my savings rate and how can I improve it?",
  "Where can I cut back the most?",
  "Summarize my finances this month.",
];

interface CopilotChatProps {
  initialMessages: ChatMessageItem[];
}

export function CopilotChat({ initialMessages }: CopilotChatProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "USER", content: trimmed },
    ]);

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Copilot error", {
          description: body?.error ?? "The copilot could not answer. Try again.",
        });
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}-reply`, role: "ASSISTANT", content: body.reply },
      ]);
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsLoading(false);
    }
  }

  async function clearConversation() {
    setIsClearing(true);
    try {
      const response = await fetch("/api/copilot", { method: "DELETE" });
      if (!response.ok) {
        toast.error("Could not clear conversation");
        return;
      }
      setMessages([]);
      toast.success("Conversation cleared");
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="bg-card flex h-[calc(100svh-11.5rem)] min-h-96 flex-col rounded-xl border shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <BotIcon className="size-4" />
          </div>
          Finance Copilot
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearConversation}
            disabled={isClearing}
            className="text-muted-foreground"
          >
            {isClearing ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            Clear
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-full">
              <BotIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">Ask me anything about your finances</p>
              <p className="text-muted-foreground text-sm">
                I have access to your transactions and can help you understand your money.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
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
                  "max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                  message.role === "USER"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                )}
              >
                {message.content}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
              <BotIcon className="size-4" />
            </div>
            <div className="bg-muted flex items-center gap-2 rounded-xl rounded-tl-sm px-4 py-3 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

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
          placeholder="Ask about your spending, savings, budgets…"
          className="max-h-32 min-h-10 resize-none"
          rows={1}
          disabled={isLoading}
        />
        <Button type="submit" size="icon" disabled={isLoading || input.trim().length === 0}>
          <SendIcon />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}
