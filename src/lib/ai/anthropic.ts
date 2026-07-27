import {
  AiError,
  messageText,
  parseSseData,
  type AiChatMessage,
  type AiChatOptions,
  type AiClient,
} from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";

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
  apiKey: string,
  messages: AiChatMessage[],
  options: AiChatOptions,
  stream: boolean
): Promise<Response> {
  const { system, conversation } = splitMessages(messages);
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
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
    throw new AiError(formatAnthropicError(response.status, body), response.status);
  }
  return response;
}

function formatAnthropicError(status: number, body: string): string {
  let message: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } };
    message = parsed.error?.message;
  } catch {
    // Non-JSON error body — fall through.
  }

  if (status === 401) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your environment.";
  }
  if (status === 429) {
    return "Anthropic is rate-limiting requests or your quota is exhausted. Check console.anthropic.com and try again.";
  }
  if (status >= 500) {
    return "Anthropic is temporarily unavailable. Please try again shortly.";
  }
  return message ? `Anthropic error: ${message}` : `Anthropic request failed (${status})`;
}

export function createAnthropicClient(apiKey: string): AiClient {
  return {
    provider: "anthropic",

    async chat(messages, options = {}) {
      const response = await request(apiKey, messages, options, false);
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
      const response = await request(apiKey, messages, options, true);
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
