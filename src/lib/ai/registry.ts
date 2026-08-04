import type { AiProviderId } from "./types";

/**
 * One description per AI provider: endpoints, model ids and the env vars that
 * override them. Everything that needs to know "which model are we actually
 * calling" reads it from here — the adapters, the health endpoint and the
 * error messages that tell an administrator which variable to change.
 *
 * Model ids are resolved on every read rather than captured at module load so
 * an env change takes effect without a cold start (and so tests can vary them).
 */
export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  keyEnvVar: string;
  modelEnvVar: string;
  visionModelEnvVar: string;
  /** Text model id in use. */
  model: string;
  /** Vision model id in use; null = this provider cannot read images. */
  visionModel: string | null;
  chatUrl: string;
  /** Cheap GET endpoint that lists models — used as a credential/liveness probe. */
  modelsUrl: string;
  billingHint?: string;
}

interface ProviderDefaults {
  label: string;
  keyEnvVar: string;
  modelEnvVar: string;
  visionModelEnvVar: string;
  defaultModel: string;
  /** null = fall back to the text model (natively multimodal providers). */
  defaultVisionModel: string | null;
  chatUrl: string;
  modelsUrl: string;
  billingHint?: string;
}

const DEFAULTS: Record<AiProviderId, ProviderDefaults> = {
  groq: {
    label: "Groq",
    keyEnvVar: "GROQ_API_KEY",
    modelEnvVar: "GROQ_MODEL",
    visionModelEnvVar: "GROQ_VISION_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    // Groq's default text model is text-only, so image requests are routed to
    // a separate multimodal model. Both rotate as Groq retires models; check
    // console.groq.com/docs/deprecations and override via env when they do.
    defaultVisionModel: "qwen/qwen3.6-27b",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    billingHint: "Check your free-tier limits at console.groq.com.",
  },
  openai: {
    label: "OpenAI",
    keyEnvVar: "OPENAI_API_KEY",
    modelEnvVar: "OPENAI_MODEL",
    visionModelEnvVar: "OPENAI_VISION_MODEL",
    defaultModel: "gpt-4o-mini",
    defaultVisionModel: null,
    chatUrl: "https://api.openai.com/v1/chat/completions",
    modelsUrl: "https://api.openai.com/v1/models",
    billingHint: "Add billing or credits at platform.openai.com, then try again.",
  },
  anthropic: {
    label: "Anthropic",
    keyEnvVar: "ANTHROPIC_API_KEY",
    modelEnvVar: "ANTHROPIC_MODEL",
    visionModelEnvVar: "ANTHROPIC_VISION_MODEL",
    defaultModel: "claude-3-5-haiku-latest",
    defaultVisionModel: null,
    chatUrl: "https://api.anthropic.com/v1/messages",
    modelsUrl: "https://api.anthropic.com/v1/models",
    billingHint: "Check your usage limits at console.anthropic.com.",
  },
};

export const AI_PROVIDER_IDS = Object.keys(DEFAULTS) as AiProviderId[];

export function getProviderConfig(id: AiProviderId): AiProviderConfig {
  const defaults = DEFAULTS[id];
  const model = process.env[defaults.modelEnvVar] || defaults.defaultModel;
  // An explicitly empty override means "this provider has no vision model",
  // which the adapters turn into a clear error instead of an upstream 400.
  const visionOverride = process.env[defaults.visionModelEnvVar];
  const visionModel =
    visionOverride !== undefined
      ? visionOverride || null
      : (defaults.defaultVisionModel ?? model);

  return {
    id,
    label: defaults.label,
    keyEnvVar: defaults.keyEnvVar,
    modelEnvVar: defaults.modelEnvVar,
    visionModelEnvVar: defaults.visionModelEnvVar,
    model,
    visionModel,
    chatUrl: defaults.chatUrl,
    modelsUrl: defaults.modelsUrl,
    billingHint: defaults.billingHint,
  };
}

/** The provider's API key, or undefined when it is not configured. */
export function getProviderApiKey(id: AiProviderId): string | undefined {
  return process.env[DEFAULTS[id].keyEnvVar] || undefined;
}
