import { getProviderApiKey, getProviderConfig, AI_PROVIDER_IDS } from "./registry";
import type { AiProviderId } from "./types";

/**
 * Diagnostic view of the AI configuration for /api/health. Reports which
 * providers have a key and which model ids they will call, so a broken
 * deployment can be identified from a URL instead of the logs.
 *
 * API keys are never included — only whether one is present.
 */
export interface AiProviderHealth {
  provider: AiProviderId;
  configured: boolean;
  keyEnvVar: string;
  /** Only reported for configured providers; nothing to diagnose otherwise. */
  model?: string;
  visionModel?: string | null;
  /** Result of the models-list probe; absent unless a probe was requested. */
  reachable?: boolean;
  /** Why the probe failed (status code or error name), never the response body. */
  probeError?: string;
}

export interface AiHealth {
  /** The provider used when a profile expresses no preference. */
  defaultProvider: AiProviderId | null;
  providers: AiProviderHealth[];
}

/** Mirrors the default-provider choice made by getAiClients(). */
export function resolveDefaultProvider(): AiProviderId | null {
  const envProvider = process.env.AI_PROVIDER as AiProviderId | undefined;
  if (envProvider && AI_PROVIDER_IDS.includes(envProvider) && getProviderApiKey(envProvider)) {
    return envProvider;
  }
  const preferred: AiProviderId[] = ["groq", "openai", "anthropic"];
  return preferred.find((id) => getProviderApiKey(id)) ?? null;
}

const PROBE_TIMEOUT_MS = 3_000;

/**
 * GETs the provider's model-list endpoint: it validates the key and the
 * network path without spending any tokens.
 */
async function probeProvider(id: AiProviderId, apiKey: string): Promise<Partial<AiProviderHealth>> {
  const config = getProviderConfig(id);
  try {
    const response = await fetch(config.modelsUrl, {
      headers:
        id === "anthropic"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok
      ? { reachable: true }
      : { reachable: false, probeError: `HTTP ${response.status}` };
  } catch (error) {
    return {
      reachable: false,
      probeError: error instanceof Error ? error.name : "unknown error",
    };
  }
}

/**
 * Describes every provider. `probe` additionally calls each configured
 * provider's models endpoint — keep it opt-in, since it makes outbound
 * requests on every health check.
 */
export async function getAiHealth({ probe = false } = {}): Promise<AiHealth> {
  const providers = await Promise.all(
    AI_PROVIDER_IDS.map(async (id): Promise<AiProviderHealth> => {
      const config = getProviderConfig(id);
      const apiKey = getProviderApiKey(id);
      if (!apiKey) {
        return { provider: id, configured: false, keyEnvVar: config.keyEnvVar };
      }
      return {
        provider: id,
        configured: true,
        keyEnvVar: config.keyEnvVar,
        model: config.model,
        visionModel: config.visionModel,
        ...(probe ? await probeProvider(id, apiKey) : {}),
      };
    })
  );

  return { defaultProvider: resolveDefaultProvider(), providers };
}
