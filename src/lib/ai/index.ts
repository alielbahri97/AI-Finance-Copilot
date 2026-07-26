import { createAnthropicClient } from "./anthropic";
import { createOpenAiClient } from "./openai";
import { AiError, type AiClient } from "./types";

export * from "./types";

/**
 * Returns the AI client for the requested provider, falling back to whichever
 * provider has an API key configured.
 */
export function getAiClient(preferred?: "openai" | "anthropic"): AiClient {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider = preferred ?? (process.env.AI_PROVIDER as "openai" | "anthropic") ?? "openai";

  if (provider === "anthropic") {
    if (anthropicKey) return createAnthropicClient(anthropicKey);
    if (openaiKey) return createOpenAiClient(openaiKey);
  } else {
    if (openaiKey) return createOpenAiClient(openaiKey);
    if (anthropicKey) return createAnthropicClient(anthropicKey);
  }

  throw new AiError(
    "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in your environment."
  );
}
