import { createOpenAiCompatibleClient } from "./openai-compatible";
import type { AiClient } from "./types";

/** Groq OpenAI-compatible chat endpoint (free tier available at console.groq.com). */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
/**
 * Groq's default text model is text-only; image requests are routed to a
 * multimodal model. qwen/qwen3.6-27b is Groq's current vision model (JSON
 * mode supported) — override with GROQ_VISION_MODEL when it rotates.
 */
const DEFAULT_VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.6-27b";

export function createGroqClient(apiKey: string): AiClient {
  return createOpenAiCompatibleClient({
    provider: "groq",
    apiKey,
    apiUrl: GROQ_API_URL,
    model: DEFAULT_MODEL,
    visionModel: DEFAULT_VISION_MODEL || null,
    label: "Groq",
    keyEnvVar: "GROQ_API_KEY",
    billingHint: "Check your free-tier limits at console.groq.com.",
  });
}
