import {
  AiError,
  messagesHaveImages,
  parseSseData,
  type AiChatMessage,
  type AiChatOptions,
  type AiClient,
} from "./types";

export type OpenAiCompatibleProvider = "openai" | "groq";

interface CompatibleClientConfig {
  provider: OpenAiCompatibleProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
  /**
   * Model used when messages contain images. null = the provider has no
   * vision-capable model configured; image requests fail with a clear error
   * instead of a confusing upstream 400.
   */
  visionModel: string | null;
  /** Human-readable name used in error messages. */
  label: string;
  /** Env var name shown when the key is rejected. */
  keyEnvVar: string;
  /** Optional docs URL for quota / billing errors. */
  billingHint?: string;
}

/** Maps provider-agnostic messages to OpenAI's chat format (incl. vision parts). */
function toOpenAiMessages(messages: AiChatMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : {
              type: "image_url" as const,
              image_url: { url: `data:${part.mediaType};base64,${part.dataBase64}` },
            }
      ),
    };
  });
}

function formatError(config: CompatibleClientConfig, status: number, body: string): string {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; type?: string; message?: string };
    };
    code = parsed.error?.code ?? parsed.error?.type;
    message = parsed.error?.message;
  } catch {
    // Non-JSON error body — fall through to generic messaging.
  }

  if (status === 401) {
    return `${config.label} rejected the API key. Check ${config.keyEnvVar} in your environment.`;
  }
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") {
    if (code === "insufficient_quota" && config.billingHint) {
      return `${config.label} quota exceeded. ${config.billingHint}`;
    }
    return `${config.label} is rate-limiting requests. Wait a moment and try again.`;
  }
  if (status >= 500) {
    return `${config.label} is temporarily unavailable. Please try again shortly.`;
  }
  return message ? `${config.label} error: ${message}` : `${config.label} request failed (${status})`;
}

async function request(
  config: CompatibleClientConfig,
  messages: AiChatMessage[],
  options: AiChatOptions,
  stream: boolean
): Promise<Response> {
  // Route image requests to the vision-capable model (the default text model
  // may reject multimodal input — e.g. Groq's llama-3.3 is text-only).
  const hasImages = messagesHaveImages(messages);
  if (hasImages && !config.visionModel) {
    throw new AiError(
      `${config.label} has no vision-capable model configured, so it cannot read images.`,
      400
    );
  }
  const model = hasImages ? config.visionModel! : config.model;

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages),
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.4,
      stream,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AiError(formatError(config, response.status, body), response.status);
  }
  return response;
}

/** Shared chat client for OpenAI-compatible HTTP APIs (OpenAI, Groq, etc.). */
export function createOpenAiCompatibleClient(config: CompatibleClientConfig): AiClient {
  return {
    provider: config.provider,
    model: config.model,
    visionModel: config.visionModel,

    async chat(messages, options = {}) {
      const response = await request(config, messages, options, false);
      const data = (await response.json()) as {
        choices: { message: { content: string | null } }[];
      };
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new AiError(`${config.label} returned an empty response`);
      }
      return content;
    },

    async *chatStream(messages, options = {}) {
      const response = await request(config, messages, options, true);
      if (!response.body) {
        throw new AiError(`${config.label} returned no stream body`);
      }

      for await (const payload of parseSseData(response.body)) {
        if (payload === "[DONE]") return;
        try {
          const event = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignore malformed keep-alive chunks.
        }
      }
    },
  };
}
