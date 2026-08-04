import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError, getAiClient, providerFromProfile, type AiChatMessage } from "@/lib/ai";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { getOrCreateProfile } from "@/lib/data";
import { buildHelpUserContext } from "@/lib/help/context";
import { getHelpTopics } from "@/lib/help/knowledge";
import { buildHelpSystemPrompt } from "@/lib/help/prompt";
import { selectTopics } from "@/lib/help/retrieval";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const maxDuration = 60;

const requestSchema = z.object({
  message: z.string().min(1).max(2000),
});

const HISTORY_LIMIT = 12;

/** The user's single help thread (most recent messages, oldest first). */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const recent = await prisma.helpMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, role: true, content: true },
    });
    return NextResponse.json({ messages: recent.reverse() });
  } catch (error) {
    logger.error("GET /api/help", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not load the help chat" }, { status: 500 });
  }
}

/** Clears the help thread. */
export async function DELETE() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await prisma.helpMessage.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("DELETE /api/help", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not clear the help chat" }, { status: 500 });
  }
}

/**
 * Streams a help-agent reply (same ndjson protocol as the copilot):
 *   {"type":"delta","text":...} repeated, then {"type":"done"} or
 *   {"type":"error","message":...}.
 *
 * Deliberately NOT plan-gated and never counted against the copilot's AI
 * message quota — support must work on every plan. The per-user rate limit
 * is the only brake.
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("help", user.id);
    if (limited) return limited;

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    const { message } = parsed.data;

    const profile = await getOrCreateProfile(user);

    const [recent, context] = await Promise.all([
      prisma.helpMessage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: { role: true, content: true },
      }),
      buildHelpUserContext(user.id),
    ]);
    const history = recent.reverse();

    await prisma.helpMessage.create({
      data: { userId: user.id, role: "USER", content: message },
    });

    // Retrieval considers the previous user question too, so follow-ups like
    // "and how do I undo it?" keep the right topics in context.
    const previousQuestion =
      [...history].reverse().find((entry) => entry.role === "USER")?.content ?? "";
    const topics = selectTopics(`${previousQuestion} ${message}`, getHelpTopics());

    const messages: AiChatMessage[] = [
      { role: "system", content: buildHelpSystemPrompt(topics, context) },
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
            // Stream already closed (client aborted); persistence still runs.
          }
        };

        let reply = "";
        let errorMessage: string | null = null;

        try {
          for await (const delta of ai.chatStream(messages, { signal: request.signal })) {
            reply += delta;
            send({ type: "delta", text: delta });
          }
        } catch (error) {
          const aborted =
            request.signal.aborted || (error instanceof Error && error.name === "AbortError");
          if (!aborted) {
            logger.error("Help agent stream", { error: serializeError(error) });
            errorMessage =
              error instanceof AiError ? error.message : "The help assistant could not respond.";
          }
        }

        if (reply.trim().length > 0) {
          await prisma.helpMessage
            .create({ data: { userId: user.id, role: "ASSISTANT", content: reply } })
            .catch((error) =>
              logger.error("Failed to persist help reply", { error: serializeError(error) })
            );
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
    logger.error("POST /api/help", { error: serializeError(error) });
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Help request failed" }, { status: 500 });
  }
}
