export type AiChatRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Provider-agnostic chat interface. Implemented by the OpenAI and Anthropic
 * adapters so the rest of the app never talks to a vendor SDK directly.
 */
export interface AiClient {
  readonly provider: "openai" | "anthropic";
  chat(messages: AiChatMessage[], options?: AiChatOptions): Promise<string>;
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
