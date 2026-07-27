import { createOpenAiCompatibleClient } from "./openai-compatible";
import type { AiClient } from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export function createOpenAiClient(apiKey: string): AiClient {
  return createOpenAiCompatibleClient({
    provider: "openai",
    apiKey,
    apiUrl: OPENAI_API_URL,
    model: DEFAULT_MODEL,
    label: "OpenAI",
    keyEnvVar: "OPENAI_API_KEY",
    billingHint: "Add billing or credits at platform.openai.com, then try again.",
  });
}
