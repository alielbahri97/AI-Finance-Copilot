export type AiChatRole = "system" | "user" | "assistant";

/** A single part of a multimodal message: plain text or an inline image. */
export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; dataBase64: string };

export interface AiChatMessage {
  role: AiChatRole;
  content: string | AiContentPart[];
}

/** Flattens message content to plain text (image parts are dropped). */
export function messageText(content: string | AiContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<AiContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * Ask the provider to force valid-JSON output (OpenAI-compatible
   * `response_format: {type:"json_object"}`). Ignored by providers without
   * native JSON mode (Anthropic — enforced via prompt there).
   */
  jsonMode?: boolean;
}

export type AiProviderId = "openai" | "anthropic" | "groq";

/** True when any message carries an inline image part. */
export function messagesHaveImages(messages: AiChatMessage[]): boolean {
  return messages.some(
    (message) =>
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "image")
  );
}

/**
 * Provider-agnostic chat interface. Implemented by the OpenAI, Groq and Anthropic
 * adapters so the rest of the app never talks to a vendor SDK directly.
 */
export interface AiClient {
  readonly provider: AiProviderId;
  /** Default text model id (for telemetry/logging). */
  readonly model: string;
  /** Vision-capable model used when messages contain images; null = no vision. */
  readonly visionModel: string | null;
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
