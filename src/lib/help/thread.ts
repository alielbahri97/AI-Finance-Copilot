import { z } from "zod";

import type { AiChatMessage } from "@/lib/ai";

import type { HelpTopic } from "./knowledge";
import { buildHelpSystemPrompt, type HelpUserContext } from "./prompt";

export const MAX_HELP_MESSAGE_LENGTH = 2000;

/** Whitespace-only questions are rejected rather than sent to the model. */
export const helpRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_HELP_MESSAGE_LENGTH),
});

export type HelpRole = "USER" | "ASSISTANT";

export interface HelpHistoryEntry {
  role: HelpRole;
  content: string;
}

/**
 * The row written for one help message.
 *
 * The help thread is scoped to the *user*, not the workspace: `help_messages`
 * has no `workspace_id` column (it was deliberately left out of the 0014
 * workspace migration) because "how do I use this app" is a personal
 * conversation that should follow someone across workspaces. Adding a
 * workspaceId here would fail the insert with an unknown-column error.
 */
export function helpMessageCreateData(userId: string, role: HelpRole, content: string) {
  return { userId, role, content };
}

/**
 * The most recent question the user asked before this one, so retrieval can
 * resolve follow-ups like "and how do I undo it?".
 */
export function previousQuestion(history: HelpHistoryEntry[]): string {
  return [...history].reverse().find((entry) => entry.role === "USER")?.content ?? "";
}

/** System prompt + prior turns + the new question, in provider-neutral form. */
export function buildHelpMessages(
  topics: HelpTopic[],
  context: HelpUserContext,
  history: HelpHistoryEntry[],
  message: string
): AiChatMessage[] {
  return [
    { role: "system", content: buildHelpSystemPrompt(topics, context) },
    ...history.map((entry) => ({
      role: entry.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: entry.content,
    })),
    { role: "user", content: message },
  ];
}
