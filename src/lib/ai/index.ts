import { createAnthropicClient } from "./anthropic";
import { createGroqClient } from "./groq";
import { createOpenAiClient } from "./openai";
import { AiError, type AiClient, type AiProviderId } from "./types";

export * from "./types";

/** Maps a stored profile enum value to the runtime provider id. */
export function providerFromProfile(
  profileProvider: "OPENAI" | "ANTHROPIC" | "GROQ" | null | undefined
): AiProviderId | undefined {
  if (profileProvider === "ANTHROPIC") return "anthropic";
  if (profileProvider === "GROQ") return "groq";
  if (profileProvider === "OPENAI") return "openai";
  return undefined;
}

/**
 * Returns the AI client for the requested provider, falling back to whichever
 * provider has an API key configured. Prefer Groq when available — it has a
 * free tier suitable for personal use.
 */
export function getAiClient(preferred?: AiProviderId): AiClient {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const envProvider = process.env.AI_PROVIDER as AiProviderId | undefined;
  const provider = preferred ?? envProvider ?? (groqKey ? "groq" : "openai");

  const factories: Record<AiProviderId, (() => AiClient) | null> = {
    groq: groqKey ? () => createGroqClient(groqKey) : null,
    openai: openaiKey ? () => createOpenAiClient(openaiKey) : null,
    anthropic: anthropicKey ? () => createAnthropicClient(anthropicKey) : null,
  };

  const preferredFactory = factories[provider];
  if (preferredFactory) return preferredFactory();

  // Prefer free Groq before paid providers when falling back.
  for (const id of ["groq", "openai", "anthropic"] as const) {
    if (id === provider) continue;
    const factory = factories[id];
    if (factory) return factory();
  }

  throw new AiError(
    "No AI provider configured. Set GROQ_API_KEY (free), OPENAI_API_KEY, or ANTHROPIC_API_KEY."
  );
}
