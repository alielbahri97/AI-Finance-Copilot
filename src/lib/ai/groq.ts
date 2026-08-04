import { createOpenAiCompatibleClient } from "./openai-compatible";
import { getProviderConfig } from "./registry";
import type { AiClient } from "./types";

/** Groq OpenAI-compatible chat endpoint (free tier available at console.groq.com). */
export function createGroqClient(apiKey: string): AiClient {
  const config = getProviderConfig("groq");
  return createOpenAiCompatibleClient({
    provider: "groq",
    apiKey,
    apiUrl: config.chatUrl,
    model: config.model,
    visionModel: config.visionModel,
    label: config.label,
    keyEnvVar: config.keyEnvVar,
    modelEnvVar: config.modelEnvVar,
    visionModelEnvVar: config.visionModelEnvVar,
    billingHint: config.billingHint,
  });
}
