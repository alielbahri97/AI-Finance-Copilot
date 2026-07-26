import { AiError, type AiChatMessage, type AiChatOptions, type AiClient } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";

export function createAnthropicClient(apiKey: string): AiClient {
  return {
    provider: "anthropic",
    async chat(messages: AiChatMessage[], options: AiChatOptions = {}) {
      // Anthropic takes the system prompt as a top-level field.
      const system = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const conversation = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          system: system || undefined,
          messages: conversation,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.4,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AiError(
          `Anthropic request failed (${response.status}): ${body}`,
          response.status
        );
      }

      const data = (await response.json()) as {
        content: { type: string; text?: string }[];
      };
      const content = data.content.find((block) => block.type === "text")?.text;
      if (!content) {
        throw new AiError("Anthropic returned an empty response");
      }
      return content;
    },
  };
}
