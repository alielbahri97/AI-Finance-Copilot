import { createOpenAiCompatibleClient } from "./openai-compatible";
import { getProviderConfig } from "./registry";
import type { AiClient } from "./types";

export function createOpenAiClient(apiKey: string): AiClient {
  const config = getProviderConfig("openai");
  return createOpenAiCompatibleClient({
    provider: "openai",
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
