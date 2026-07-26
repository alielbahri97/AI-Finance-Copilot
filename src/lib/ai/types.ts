export type AiChatRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Provider-agnostic chat interface. Implemented by the OpenAI and Anthropic
 * adapters so the rest of the app never talks to a vendor SDK directly.
 */
export interface AiClient {
  readonly provider: "openai" | "anthropic";
  chat(messages: AiChatMessage[], options?: AiChatOptions): Promise<string>;
  /** Streams the assistant reply as text deltas. */
  chatStream(messages: AiChatMessage[], options?: AiChatOptions): AsyncGenerator<string>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * Parses a server-sent-events body into the `data:` payload strings.
 * Shared by both provider adapters.
 */
export async function* parseSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
