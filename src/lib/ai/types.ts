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

/**
 * Normalized failure kinds, so callers can react to *what* went wrong without
 * pattern-matching vendor-specific strings:
 *  - `auth`      the API key is missing/rejected
 *  - `quota`     out of credit or over a hard billing limit
 *  - `rate_limit`too many requests, retryable
 *  - `model`     the requested model id is unknown or decommissioned
 *  - `upstream`  provider-side outage (5xx)
 */
export type AiErrorCode = "auth" | "quota" | "rate_limit" | "model" | "upstream";

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: AiErrorCode
  ) {
    super(message);
    this.name = "AiError";
  }
}

const AI_ERROR_CODES = new Set<string>([
  "auth",
  "quota",
  "rate_limit",
  "model",
  "upstream",
] satisfies AiErrorCode[]);

/**
 * Reads the normalized fields structurally rather than via `instanceof`, so
 * classification still works when an error crosses a module boundary that
 * loaded its own copy of this class.
 */
function readAiError(error: unknown): { code?: AiErrorCode; status?: number; message: string } {
  if (!error || typeof error !== "object") {
    return { message: String(error ?? "") };
  }
  const { code, status, message } = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return {
    code: typeof code === "string" && AI_ERROR_CODES.has(code) ? (code as AiErrorCode) : undefined,
    status: typeof status === "number" ? status : undefined,
    message: typeof message === "string" ? message : "",
  };
}

/**
 * True when the provider rejected the *model id* rather than the request —
 * the failure mode when a hosted model is retired out from under us. Falls
 * back to matching the upstream text for providers that do not send a code.
 */
export function isModelError(error: unknown): boolean {
  const { code, status, message } = readAiError(error);
  if (code) return code === "model";
  if (status !== 400 && status !== 404) return false;

  const text = message.toLowerCase();
  if (!text.includes("model")) return false;
  return [
    "model_not_found",
    "model_decommissioned",
    "decommissioned",
    "does not exist",
    "no longer supported",
    "no longer serves",
    "has been deprecated",
    "unknown model",
    "invalid model",
  ].some((needle) => text.includes(needle));
}

/** True when the provider is out of credit, over quota, or throttling. */
export function isQuotaError(error: unknown): boolean {
  const { code, status, message } = readAiError(error);
  if (code) return code === "quota" || code === "rate_limit";
  if (status === 429) return true;

  const text = message.toLowerCase();
  return ["quota", "billing", "insufficient"].some((needle) => text.includes(needle));
}

/**
 * Whether a failure with the current provider is worth retrying on the next
 * configured one. Quota/model errors are provider-specific and will not
 * resolve on retry, so another provider is strictly better than an error.
 */
export function shouldTryNextProvider(error: unknown): boolean {
  return isQuotaError(error) || isModelError(error);
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
