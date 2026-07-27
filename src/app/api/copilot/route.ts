import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError, getAiClient, providerFromProfile, type AiChatMessage } from "@/lib/ai";
import { buildFinancialSnapshot } from "@/lib/ai/context";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { trackEvent } from "@/lib/analytics";
import { checkLimit, getEntitlements, incrementUsage, limitError } from "@/lib/billing/entitlements";
import { getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { logger, serializeError } from "@/lib/logger";

export const maxDuration = 120;

const requestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
});

const HISTORY_LIMIT = 20;

function titleFromMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  return singleLine.length > 60 ? `${singleLine.slice(0, 57)}…` : singleLine;
}

/**
 * Streams an assistant reply. The response body is newline-delimited JSON:
 *   {"type":"meta","conversationId":...,"title":...}   (once, first)
 *   {"type":"delta","text":...}                        (repeated)
 *   {"type":"done"} | {"type":"error","message":...}   (last)
 * The user message is persisted before streaming; the assistant message is
 * persisted when the stream finishes (including partial output if the client
 * aborts mid-stream).
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("ai", user.id);
    if (limited) return limited;

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    const { message, conversationId } = parsed.data;

    const profile = await getOrCreateProfile(user);

    // Plan gating: monthly AI message quota.
    const entitlements = await getEntitlements(user.id);
    const quota = checkLimit(entitlements, "aiMessages", entitlements.plan.limits.aiMessagesPerMonth);
    if (!quota.allowed) {
      return NextResponse.json(limitError("AI message", entitlements.planId), { status: 402 });
    }
    await incrementUsage(user.id, "aiMessages");
    await trackEvent(user.id, "ai_message", { conversationId: conversationId ?? null });

    // Resolve or create the conversation.
    let conversation: { id: string; title: string };
    let history: { role: "USER" | "ASSISTANT"; content: string }[] = [];

    if (conversationId) {
      const existing = await prisma.conversation.findFirst({
        where: { id: conversationId, userId: user.id },
        select: { id: true, title: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      conversation = existing;
      const recent = await prisma.chatMessage.findMany({
        where: { conversationId: existing.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: { role: true, content: true },
      });
      history = recent.reverse();
    } else {
      conversation = await prisma.conversation.create({
        data: { userId: user.id, title: titleFromMessage(message) },
        select: { id: true, title: true },
      });
    }

    await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          userId: user.id,
          conversationId: conversation.id,
          role: "USER",
          content: message,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    const snapshot = await buildFinancialSnapshot(user.id, profile.currency);
    const messages: AiChatMessage[] = [
      { role: "system", content: buildSystemPrompt(snapshot) },
      ...history.map((entry) => ({
        role: entry.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: entry.content,
      })),
      { role: "user", content: message },
    ];

    const ai = getAiClient(providerFromProfile(profile.aiProvider));
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Stream already closed (client aborted); persistence still runs below.
          }
        };

        let reply = "";
        let errorMessage: string | null = null;
        send({ type: "meta", conversationId: conversation.id, title: conversation.title });

        try {
          for await (const delta of ai.chatStream(messages, { signal: request.signal })) {
            reply += delta;
            send({ type: "delta", text: delta });
          }
        } catch (error) {
          const aborted =
            request.signal.aborted || (error instanceof Error && error.name === "AbortError");
          if (!aborted) {
            logger.error("Copilot stream", { error: serializeError(error) });
            errorMessage =
              error instanceof AiError ? error.message : "The assistant could not respond.";
          }
        }

        // Persist before signaling completion so a client-side refresh
        // immediately sees the full message (partial output is kept on abort).
        if (reply.trim().length > 0) {
          await prisma.chatMessage
            .create({
              data: {
                userId: user.id,
                conversationId: conversation.id,
                role: "ASSISTANT",
                content: reply,
              },
            })
            .catch((error) => logger.error("Failed to persist assistant message", { error: serializeError(error) }));
        }

        send(errorMessage ? { type: "error", message: errorMessage } : { type: "done" });
        try {
          controller.close();
        } catch {
          // Already closed by a client abort.
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    logger.error("POST /api/copilot", { error: serializeError(error) });
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Copilot request failed" }, { status: 500 });
  }
}
