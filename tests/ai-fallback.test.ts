import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { AiError, type AiClient } from "@/lib/ai/types";

/** Lets a single test decide how the OpenAI adapter fails. */
const openAiFailure = { error: new AiError("OpenAI quota exceeded. Add billing.", 429) };

vi.mock("@/lib/ai/groq", () => ({
  createGroqClient: (key: string): AiClient => ({
    provider: "groq",
    model: "groq-model",
    visionModel: "groq-vision",
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
    model: "openai-model",
    visionModel: "openai-vision",
    async chat() {
      throw openAiFailure.error;
    },
    async *chatStream() {
      throw openAiFailure.error;
    },
  }),
}));

vi.mock("@/lib/ai/anthropic", () => ({
  createAnthropicClient: (): AiClient => ({
    provider: "anthropic",
    model: "anthropic-model",
    visionModel: "anthropic-vision",
    async chat() {
      return "anthropic-ok";
    },
    async *chatStream() {
      yield "anthropic-stream";
    },
  }),
}));

describe("getAiClient provider fallback", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = "gsk_test_key";
    process.env.OPENAI_API_KEY = "sk_test_key";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_PROVIDER = "openai";
    openAiFailure.error = new AiError("OpenAI quota exceeded. Add billing.", 429);
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

  it("falls back when the preferred provider's model has been retired", async () => {
    openAiFailure.error = new AiError("OpenAI no longer serves the model...", 404, "model");
    const { getAiClient } = await import("@/lib/ai/index");
    const client = getAiClient("openai");

    await expect(client.chat([{ role: "user", content: "hi" }])).resolves.toMatch(/^groq:/);
    const chunks: string[] = [];
    for await (const chunk of client.chatStream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["groq-stream"]);
  });

  it("surfaces errors that another provider would not fix", async () => {
    openAiFailure.error = new AiError("OpenAI error: messages must not be empty", 400);
    const { getAiClient } = await import("@/lib/ai/index");
    const client = getAiClient("openai");
    await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /messages must not be empty/
    );
  });

  it("orders the preferred provider first and Groq ahead of paid fallbacks", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { getAiClients } = await import("@/lib/ai/index");
    expect(getAiClients("anthropic").map((client) => client.provider)).toEqual([
      "anthropic",
      "groq",
      "openai",
    ]);
    expect(getAiClients("openai").map((client) => client.provider)).toEqual([
      "openai",
      "groq",
      "anthropic",
    ]);
  });

  it("skips providers with no API key", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { getAiClients } = await import("@/lib/ai/index");
    expect(getAiClients("openai").map((client) => client.provider)).toEqual(["groq"]);
  });

  it("explains what to configure when no provider has a key", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { getAiClient } = await import("@/lib/ai/index");
    expect(() => getAiClient()).toThrow(/GROQ_API_KEY/);
  });
});
