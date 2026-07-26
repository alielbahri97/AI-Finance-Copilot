import { AiError, type AiChatMessage, type AiChatOptions, type AiClient } from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export function createOpenAiClient(apiKey: string): AiClient {
  return {
    provider: "openai",
    async chat(messages: AiChatMessage[], options: AiChatOptions = {}) {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.4,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AiError(`OpenAI request failed (${response.status}): ${body}`, response.status);
      }

      const data = (await response.json()) as {
        choices: { message: { content: string | null } }[];
      };
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new AiError("OpenAI returned an empty response");
      }
      return content;
    },
  };
}
