"use client";

import { useState } from "react";

import { CopilotChat, type ChatMessageItem } from "@/components/copilot/chat";
import {
  ConversationSidebar,
  type ConversationItem,
} from "@/components/copilot/conversation-sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface CopilotShellProps {
  conversations: ConversationItem[];
  activeId: string | null;
  initialMessages: ChatMessageItem[];
  suggestions: string[];
  quotaExhausted?: boolean;
}

export function CopilotShell({
  conversations,
  activeId,
  initialMessages,
  suggestions,
  quotaExhausted,
}: CopilotShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="grid h-[calc(100svh-11.5rem)] min-h-[480px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="bg-card hidden rounded-xl border p-3 shadow-sm lg:block">
        <ConversationSidebar conversations={conversations} activeId={activeId} />
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-80 p-4">
          <SheetHeader className="p-0 pb-3">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          <ConversationSidebar
            conversations={conversations}
            activeId={activeId}
            onNavigate={() => setHistoryOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <CopilotChat
        key={activeId ?? "new"}
        conversationId={activeId}
        initialMessages={initialMessages}
        suggestions={suggestions}
        quotaExhausted={quotaExhausted}
        onOpenHistory={() => setHistoryOpen(true)}
      />
    </div>
  );
}
