"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  Loader2Icon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface ConversationSidebarProps {
  conversations: ConversationItem[];
  activeId: string | null;
  /** Called after navigation, e.g. to close the mobile sheet. */
  onNavigate?: () => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  onNavigate,
}: ConversationSidebarProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function open(id: string | null) {
    router.push(id ? `/copilot?c=${id}` : "/copilot");
    onNavigate?.();
  }

  async function rename(id: string) {
    const title = editTitle.trim();
    if (!title) return;
    setBusyId(id);
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not rename conversation", { description: body?.error });
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete conversation", { description: body?.error });
        return;
      }
      toast.success("Conversation deleted");
      if (id === activeId) {
        router.push("/copilot");
        onNavigate?.();
      }
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <Button variant="outline" className="justify-start" onClick={() => open(null)}>
        <PlusIcon />
        New conversation
      </Button>

      <div className="flex-1 space-y-0.5 overflow-y-auto pr-1">
        {conversations.length === 0 && (
          <EmptyState
            className="gap-2 px-2 py-8"
            icon={MessageSquareIcon}
            title="No conversations yet"
            description="Anything you ask is saved here so you can pick it back up."
          />
        )}
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeId;
          const isEditing = editingId === conversation.id;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
                isActive ? "bg-accent" : "hover:bg-muted/60"
              )}
            >
              {isEditing ? (
                <>
                  <Input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") rename(conversation.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    className="h-7 flex-1 text-sm"
                    maxLength={80}
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    disabled={busyId === conversation.id || !editTitle.trim()}
                    onClick={() => rename(conversation.id)}
                    aria-label="Save title"
                  >
                    {busyId === conversation.id ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <CheckIcon />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel rename"
                  >
                    <XIcon />
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => open(conversation.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  >
                    <MessageSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate text-sm" title={conversation.title}>
                      {conversation.title}
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      setEditingId(conversation.id);
                      setEditTitle(conversation.title);
                    }}
                    aria-label={`Rename ${conversation.title}`}
                  >
                    <PencilIcon />
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        disabled={busyId === conversation.id}
                        aria-label={`Delete ${conversation.title}`}
                      >
                        {busyId === conversation.id ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                      </Button>
                    }
                    title={`Delete “${conversation.title}”?`}
                    description="The whole thread goes for good, your questions and the answers both. Your transactions, budgets and goals are untouched."
                    confirmLabel="Delete conversation"
                    onConfirm={() => remove(conversation.id)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
