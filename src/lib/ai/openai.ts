import {
  AiError,
  parseSseData,
  type AiChatMessage,
  type AiChatOptions,
  type AiClient,
} from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Maps provider-agnostic messages to OpenAI's format (incl. vision parts). */
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

async function request(
  apiKey: string,
  messages: AiChatMessage[],
  options: AiChatOptions,
  stream: boolean
): Promise<Response> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: toOpenAiMessages(messages),
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.4,
      stream,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AiError(formatOpenAiError(response.status, body), response.status);
  }
  return response;
}

function formatOpenAiError(status: number, body: string): string {
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
    return "OpenAI rejected the API key. Check OPENAI_API_KEY in your environment.";
  }
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") {
    if (code === "insufficient_quota") {
      return "OpenAI quota exceeded. Add billing or credits at platform.openai.com, then try again.";
    }
    return "OpenAI is rate-limiting requests. Wait a moment and try again.";
  }
  if (status >= 500) {
    return "OpenAI is temporarily unavailable. Please try again shortly.";
  }
  return message ? `OpenAI error: ${message}` : `OpenAI request failed (${status})`;
}

export function createOpenAiClient(apiKey: string): AiClient {
  return {
    provider: "openai",

    async chat(messages, options = {}) {
      const response = await request(apiKey, messages, options, false);
      const data = (await response.json()) as {
        choices: { message: { content: string | null } }[];
      };
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new AiError("OpenAI returned an empty response");
      }
      return content;
    },

    async *chatStream(messages, options = {}) {
      const response = await request(apiKey, messages, options, true);
      if (!response.body) {
        throw new AiError("OpenAI returned no stream body");
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
