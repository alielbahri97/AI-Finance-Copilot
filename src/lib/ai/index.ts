import { logger, serializeError } from "@/lib/logger";

import { createAnthropicClient } from "./anthropic";
import { createGroqClient } from "./groq";
import { createOpenAiClient } from "./openai";
import { getProviderApiKey } from "./registry";
import {
  AiError,
  shouldTryNextProvider,
  type AiChatMessage,
  type AiChatOptions,
  type AiClient,
  type AiProviderId,
} from "./types";

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

function logFallback(from: AiClient, to: AiClient, error: unknown): void {
  logger.warn("AI provider fallback", {
    from: from.provider,
    fromModel: from.model,
    to: to.provider,
    toModel: to.model,
    error: serializeError(error),
  });
}

/**
 * Tries providers in order. On quota/billing or retired-model failures, falls
 * through to the next configured provider so Copilot keeps working when OpenAI
 * is unpaid or a hosted model is decommissioned underneath us.
 */
function withProviderFallback(clients: AiClient[]): AiClient {
  if (clients.length === 1) return clients[0]!;

  return {
    get provider() {
      return clients[0]!.provider;
    },
    get model() {
      return clients[0]!.model;
    },
    get visionModel() {
      return clients[0]!.visionModel;
    },

    async chat(messages: AiChatMessage[], options?: AiChatOptions) {
      let lastError: unknown;
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i]!;
        try {
          return await client.chat(messages, options);
        } catch (error) {
          lastError = error;
          const canFallback = i < clients.length - 1 && shouldTryNextProvider(error);
          if (!canFallback) throw error;
          logFallback(client, clients[i + 1]!, error);
        }
      }
      throw lastError instanceof Error ? lastError : new AiError("All AI providers failed");
    },

    async *chatStream(messages: AiChatMessage[], options?: AiChatOptions) {
      let lastError: unknown;
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i]!;
        let started = false;
        try {
          // for-await so quota errors before the first chunk are catchable;
          // once we have streamed any text, do not switch providers mid-reply.
          for await (const delta of client.chatStream(messages, options)) {
            started = true;
            yield delta;
          }
          return;
        } catch (error) {
          lastError = error;
          const canFallback =
            !started && i < clients.length - 1 && shouldTryNextProvider(error);
          if (!canFallback) throw error;
          logFallback(client, clients[i + 1]!, error);
        }
      }
      throw lastError instanceof Error ? lastError : new AiError("All AI providers failed");
    },
  };
}

/**
 * All configured provider clients, ordered: the preferred provider first,
 * then Groq (free) before the paid providers. Empty when no key is set.
 */
export function getAiClients(preferred?: AiProviderId): AiClient[] {
  const groqKey = getProviderApiKey("groq");
  const openaiKey = getProviderApiKey("openai");
  const anthropicKey = getProviderApiKey("anthropic");
  const envProvider = process.env.AI_PROVIDER as AiProviderId | undefined;
  const provider = preferred ?? envProvider ?? (groqKey ? "groq" : "openai");

  const factories: Record<AiProviderId, (() => AiClient) | null> = {
    groq: groqKey ? () => createGroqClient(groqKey) : null,
    openai: openaiKey ? () => createOpenAiClient(openaiKey) : null,
    anthropic: anthropicKey ? () => createAnthropicClient(anthropicKey) : null,
  };

  const order: AiProviderId[] = [];
  const push = (id: AiProviderId) => {
    if (!order.includes(id) && factories[id]) order.push(id);
  };

  push(provider);
  // Prefer free Groq before paid providers when falling back.
  for (const id of ["groq", "openai", "anthropic"] as const) {
    push(id);
  }

  return order.map((id) => factories[id]!());
}

/**
 * Returns the AI client for the requested provider, falling back to whichever
 * provider has an API key configured. Prefer Groq when available — it has a
 * free tier suitable for personal use. Quota and retired-model failures
 * automatically retry with the next configured provider.
 */
export function getAiClient(preferred?: AiProviderId): AiClient {
  const clients = getAiClients(preferred);
  if (clients.length === 0) {
    throw new AiError(
      "No AI provider configured. Set GROQ_API_KEY (free), OPENAI_API_KEY, or ANTHROPIC_API_KEY.",
      undefined,
      "auth"
    );
  }
  return withProviderFallback(clients);
}
