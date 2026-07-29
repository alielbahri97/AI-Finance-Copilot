import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { AiError, type AiClient } from "@/lib/ai/types";

vi.mock("@/lib/ai/groq", () => ({
  createGroqClient: (key: string): AiClient => ({
    provider: "groq",
    async chat() {
      return `groq:${key.slice(0, 4)}`;
    },
    async *chatStream() {
      yield "groq-stream";
    },
  }),
}));

vi.mock("@/lib/ai/openai", () => ({
  createOpenAiClient: (): AiClient => ({
    provider: "openai",
    async chat() {
      throw new AiError("OpenAI quota exceeded. Add billing.", 429);
    },
    async *chatStream() {
      throw new AiError("OpenAI quota exceeded. Add billing.", 429);
    },
  }),
}));

vi.mock("@/lib/ai/anthropic", () => ({
  createAnthropicClient: (): AiClient => ({
    provider: "anthropic",
    async chat() {
      return "anthropic-ok";
    },
    async *chatStream() {
      yield "anthropic-stream";
    },
  }),
}));

describe("getAiClient quota fallback", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = "gsk_test_key";
    process.env.OPENAI_API_KEY = "sk_test_key";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_PROVIDER = "openai";
  });

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  it("falls back to Groq when preferred OpenAI hits quota", async () => {
    const { getAiClient } = await import("@/lib/ai/index");
    const client = getAiClient("openai");
    await expect(client.chat([{ role: "user", content: "hi" }])).resolves.toMatch(/^groq:/);
  });

  it("falls back on stream quota errors", async () => {
    const { getAiClient } = await import("@/lib/ai/index");
    const client = getAiClient("openai");
    const chunks: string[] = [];
    for await (const chunk of client.chatStream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["groq-stream"]);
  });
});
