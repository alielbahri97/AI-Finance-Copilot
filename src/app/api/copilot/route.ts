import { NextResponse } from "next/server";
import { z } from "zod";

import { AiError, getAiClient, type AiChatMessage } from "@/lib/ai";
import { getFinancialContext, getOrCreateProfile } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/supabase/server";

export const maxDuration = 60;

const requestSchema = z.object({
  message: z.string().min(1).max(4000),
});

const SYSTEM_PROMPT = `You are FinPilot, a friendly and pragmatic personal finance copilot.
You help the user understand their spending, income, budgets and savings.
Ground every answer in the financial data provided below. Be concise and concrete;
use numbers from the data when relevant. If asked something unrelated to personal
finance, politely steer the conversation back. Never invent transactions that are
not in the data.`;

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const profile = await getOrCreateProfile(user);
    const financialContext = await getFinancialContext(user.id);

    // Last 20 messages give the model conversational memory.
    const history = await prisma.chatMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const messages: AiChatMessage[] = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nUser currency: ${profile.currency}\n\n${financialContext}`,
      },
      ...history.reverse().map((message) => ({
        role: message.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: message.content,
      })),
      { role: "user", content: parsed.data.message },
    ];

    const ai = getAiClient(profile.aiProvider === "ANTHROPIC" ? "anthropic" : "openai");
    const reply = await ai.chat(messages);

    await prisma.$transaction([
      prisma.chatMessage.create({
        data: { userId: user.id, role: "USER", content: parsed.data.message },
      }),
      prisma.chatMessage.create({
        data: { userId: user.id, role: "ASSISTANT", content: reply },
      }),
    ]);

    return NextResponse.json({ reply, provider: ai.provider });
  } catch (error) {
    console.error("POST /api/copilot failed:", error);
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Copilot request failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await prisma.chatMessage.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/copilot failed:", error);
    return NextResponse.json({ error: "Failed to clear conversation" }, { status: 500 });
  }
}
