import { createOpenAiCompatibleClient } from "./openai-compatible";
import type { AiClient } from "./types";

/** Groq OpenAI-compatible chat endpoint (free tier available at console.groq.com). */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

export function createGroqClient(apiKey: string): AiClient {
  return createOpenAiCompatibleClient({
    provider: "groq",
    apiKey,
    apiUrl: GROQ_API_URL,
    model: DEFAULT_MODEL,
    label: "Groq",
    keyEnvVar: "GROQ_API_KEY",
    billingHint: "Check your free-tier limits at console.groq.com.",
  });
}
