import { NextResponse } from "next/server";

import { AiError, getAiClient, providerFromProfile } from "@/lib/ai";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { getOrCreateProfile } from "@/lib/data";
import { classifyDatabaseFailure } from "@/lib/db-errors";
import { buildHelpUserContext } from "@/lib/help/context";
import { getHelpTopics } from "@/lib/help/knowledge";
import { selectTopics } from "@/lib/help/retrieval";
import {
  buildHelpMessages,
  helpMessageCreateData,
  helpRequestSchema,
  previousQuestion,
} from "@/lib/help/thread";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace/context";

export const maxDuration = 60;

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

    const body = await request.json().catch(() => null);
    const parsed = helpRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    const { message } = parsed.data;

    const profile = await getOrCreateProfile(user);

    // Support must reach every authenticated member, so the workspace is
    // resolved without gating on a permission, and a failure to resolve it only
    // costs the situational details in the prompt. The thread itself is
    // personal: help_messages is user-scoped and was deliberately left out of
    // the 0014 workspace migration.
    const workspaceId = await getWorkspaceContext()
      .then((ctx) => ctx?.workspace.id ?? null)
      .catch((error) => {
        logger.error("Help could not resolve a workspace", { error: serializeError(error) });
        return null;
      });

    const [recent, context] = await Promise.all([
      prisma.helpMessage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: { role: true, content: true },
      }),
      buildHelpUserContext(workspaceId),
    ]);
    const history = recent.reverse();

    const question = await prisma.helpMessage.create({
      data: helpMessageCreateData(user.id, "USER", message),
      select: { id: true },
    });

    // Retrieval considers the previous user question too, so follow-ups like
    // "and how do I undo it?" keep the right topics in context.
    const topics = selectTopics(`${previousQuestion(history)} ${message}`, getHelpTopics());
    const messages = buildHelpMessages(topics, context, history, message);

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
            .create({ data: helpMessageCreateData(user.id, "ASSISTANT", reply) })
            .catch((error) =>
              logger.error("Failed to persist help reply", { error: serializeError(error) })
            );
        } else if (errorMessage) {
          // Nothing was answered, so drop the question too — otherwise the
          // thread reloads with an unanswered message and the next turn feeds
          // that dead end back to the model as context.
          await prisma.helpMessage
            .delete({ where: { id: question.id } })
            .catch((error) =>
              logger.error("Failed to roll back the help question", {
                error: serializeError(error),
              })
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
    return NextResponse.json({ error: describeFailure(error) }, { status: 500 });
  }
}

/**
 * The help agent is where users go when something else is broken, so its
 * errors name the actual problem instead of a generic failure.
 */
function describeFailure(error: unknown): string {
  switch (classifyDatabaseFailure(error)) {
    case "schema_outdated":
      return "The database is missing an update this version of the app needs. An administrator must apply the pending migrations.";
    case "unavailable":
      return "The database is not reachable right now. Please try again in a moment.";
    default:
      return "The help assistant could not handle that request. The error has been logged.";
  }
}
