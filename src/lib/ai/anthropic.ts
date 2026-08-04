import { logger } from "@/lib/logger";

import { getProviderConfig, type AiProviderConfig } from "./registry";
import {
  AiError,
  messagesHaveImages,
  messageText,
  parseSseData,
  type AiChatMessage,
  type AiChatOptions,
  type AiClient,
  type AiErrorCode,
} from "./types";

/** Maps message content to Anthropic content blocks (incl. vision parts). */
function toAnthropicContent(content: AiChatMessage["content"]) {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: part.mediaType,
            data: part.dataBase64,
          },
        }
  );
}

function splitMessages(messages: AiChatMessage[]) {
  // Anthropic takes the system prompt as a top-level (text-only) field.
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => messageText(message.content))
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: toAnthropicContent(message.content) }));
  return { system: system || undefined, conversation };
}

async function request(
  config: AiProviderConfig,
  apiKey: string,
  messages: AiChatMessage[],
  options: AiChatOptions,
  stream: boolean
): Promise<Response> {
  const { system, conversation } = splitMessages(messages);
  const hasImages = messagesHaveImages(messages);
  if (hasImages && !config.visionModel) {
    throw new AiError("Anthropic has no vision-capable model configured, so it cannot read images.", 400);
  }
  const model = hasImages ? config.visionModel! : config.model;
  const response = await fetch(config.chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system,
      messages: conversation,
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.4,
      stream,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    const { message, code } = formatAnthropicError(response.status, body, model, hasImages);
    logger.error("AI provider request failed", {
      provider: "anthropic",
      model,
      status: response.status,
      code,
      upstream: body.slice(0, 500),
    });
    throw new AiError(message, response.status, code);
  }
  return response;
}

export function formatAnthropicError(
  status: number,
  body: string,
  model: string,
  usedVisionModel = false
): { message: string; code?: AiErrorCode } {
  let message: string | undefined;
  let type: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } };
    message = parsed.error?.message;
    type = parsed.error?.type;
  } catch {
    // Non-JSON error body — fall through.
  }

  if (status === 401 || status === 403) {
    return {
      message: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your environment.",
      code: "auth",
    };
  }
  if (status === 429) {
    return {
      message:
        "Anthropic is rate-limiting requests or your quota is exhausted. Check console.anthropic.com and try again.",
      code: "rate_limit",
    };
  }
  if (
    (status === 400 || status === 404) &&
    (type === "not_found_error" || /model/i.test(message ?? ""))
  ) {
    const envVar = usedVisionModel ? "ANTHROPIC_VISION_MODEL" : "ANTHROPIC_MODEL";
    return {
      message:
        `Anthropic no longer serves the model "${model}" — it has been retired or renamed. ` +
        `Set ${envVar} to a current model id.`,
      code: "model",
    };
  }
  if (status >= 500) {
    return {
      message: "Anthropic is temporarily unavailable. Please try again shortly.",
      code: "upstream",
    };
  }
  return {
    message: message ? `Anthropic error: ${message}` : `Anthropic request failed (${status})`,
  };
}

export function createAnthropicClient(apiKey: string): AiClient {
  const config = getProviderConfig("anthropic");
  return {
    provider: "anthropic",
    model: config.model,
    visionModel: config.visionModel,

    async chat(messages, options = {}) {
      const response = await request(config, apiKey, messages, options, false);
      const data = (await response.json()) as {
        content: { type: string; text?: string }[];
      };
      const content = data.content.find((block) => block.type === "text")?.text;
      if (!content) {
        throw new AiError("Anthropic returned an empty response");
      }
      return content;
    },

    async *chatStream(messages, options = {}) {
      const response = await request(config, apiKey, messages, options, true);
      if (!response.body) {
        throw new AiError("Anthropic returned no stream body");
      }

      for await (const payload of parseSseData(response.body)) {
        try {
          const event = JSON.parse(payload) as {
            type: string;
            delta?: { type?: string; text?: string };
            error?: { message?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            if (event.delta.text) yield event.delta.text;
          } else if (event.type === "error") {
            throw new AiError(event.error?.message ?? "Anthropic stream error");
          } else if (event.type === "message_stop") {
            return;
          }
        } catch (error) {
          if (error instanceof AiError) throw error;
          // Ignore malformed keep-alive chunks.
        }
      }
    },
  };
}
