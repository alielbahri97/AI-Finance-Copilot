import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatAnthropicError } from "@/lib/ai/anthropic";
import { formatError } from "@/lib/ai/openai-compatible";
import { AI_PROVIDER_IDS, getProviderApiKey, getProviderConfig } from "@/lib/ai/registry";
import { AiError, isModelError, isQuotaError, shouldTryNextProvider } from "@/lib/ai/types";

const groqConfig = {
  provider: "groq" as const,
  apiKey: "gsk_secret",
  apiUrl: "https://api.groq.com/openai/v1/chat/completions",
  model: "some-text-model",
  visionModel: "some-vision-model",
  label: "Groq",
  keyEnvVar: "GROQ_API_KEY",
  modelEnvVar: "GROQ_MODEL",
  visionModelEnvVar: "GROQ_VISION_MODEL",
  billingHint: "Check your free-tier limits at console.groq.com.",
};

function upstream(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

/* ------------------------------------------------------------------ */
/* Provider registry                                                   */
/* ------------------------------------------------------------------ */

describe("provider registry", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("describes every provider with the env vars that override it", () => {
    expect(AI_PROVIDER_IDS).toEqual(["groq", "openai", "anthropic"]);
    for (const id of AI_PROVIDER_IDS) {
      const config = getProviderConfig(id);
      expect(config.model.length).toBeGreaterThan(0);
      expect(config.keyEnvVar).toMatch(/_API_KEY$/);
      expect(config.modelEnvVar).toMatch(/_MODEL$/);
      expect(config.chatUrl).toMatch(/^https:\/\//);
      expect(config.modelsUrl).toMatch(/^https:\/\//);
    }
  });

  it("keeps Groq's shipped defaults so a working deployment is not changed", () => {
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_VISION_MODEL;
    const config = getProviderConfig("groq");
    expect(config.model).toBe("llama-3.3-70b-versatile");
    expect(config.visionModel).toBe("qwen/qwen3.6-27b");
  });

  it("lets env vars override the model ids without a code change", () => {
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_VISION_MODEL = "some/other-vision";
    const config = getProviderConfig("groq");
    expect(config.model).toBe("openai/gpt-oss-120b");
    expect(config.visionModel).toBe("some/other-vision");
  });

  it("reads model ids per call, so an env change needs no cold start", () => {
    process.env.OPENAI_MODEL = "first";
    expect(getProviderConfig("openai").model).toBe("first");
    process.env.OPENAI_MODEL = "second";
    expect(getProviderConfig("openai").model).toBe("second");
  });

  it("treats providers without a vision override as natively multimodal", () => {
    delete process.env.OPENAI_VISION_MODEL;
    const config = getProviderConfig("openai");
    expect(config.visionModel).toBe(config.model);
  });

  it("treats an empty vision override as 'cannot read images'", () => {
    process.env.GROQ_VISION_MODEL = "";
    expect(getProviderConfig("groq").visionModel).toBeNull();
  });

  it("reports a provider as unconfigured when its key is missing or blank", () => {
    process.env.GROQ_API_KEY = "gsk_live";
    expect(getProviderApiKey("groq")).toBe("gsk_live");
    process.env.GROQ_API_KEY = "";
    expect(getProviderApiKey("groq")).toBeUndefined();
    delete process.env.GROQ_API_KEY;
    expect(getProviderApiKey("groq")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */

describe("upstream error classification", () => {
  it("names the model and the env var when a model is retired", () => {
    const result = formatError(
      groqConfig,
      400,
      upstream("model_decommissioned", "The model `llama-3.3-70b-versatile` has been decommissioned."),
      "llama-3.3-70b-versatile"
    );
    expect(result.code).toBe("model");
    expect(result.message).toContain("llama-3.3-70b-versatile");
    expect(result.message).toContain("GROQ_MODEL");
  });

  it("points at the vision env var when the image model is the one refused", () => {
    const result = formatError(
      groqConfig,
      404,
      upstream("model_not_found", "The model `old-vision` does not exist"),
      "old-vision",
      true
    );
    expect(result.code).toBe("model");
    expect(result.message).toContain("GROQ_VISION_MODEL");
  });

  it("distinguishes auth, quota and rate-limit failures", () => {
    expect(formatError(groqConfig, 401, "{}", "m").code).toBe("auth");
    expect(formatError(groqConfig, 403, "{}", "m").code).toBe("auth");
    expect(
      formatError(groqConfig, 400, upstream("insufficient_quota", "no credit"), "m").code
    ).toBe("quota");
    expect(formatError(groqConfig, 429, "{}", "m").code).toBe("rate_limit");
    expect(formatError(groqConfig, 503, "{}", "m").code).toBe("upstream");
  });

  it("never leaks the API key into a user-facing message", () => {
    for (const status of [400, 401, 404, 429, 500]) {
      const { message } = formatError(groqConfig, status, upstream("x", "boom"), "m");
      expect(message).not.toContain(groqConfig.apiKey);
    }
  });

  it("does not mistake an ordinary bad request for a model problem", () => {
    const result = formatError(
      groqConfig,
      400,
      upstream("invalid_request_error", "messages must not be empty"),
      "m"
    );
    expect(result.code).toBeUndefined();
    expect(result.message).toContain("messages must not be empty");
  });

  it("classifies Anthropic model errors the same way", () => {
    const result = formatAnthropicError(
      404,
      JSON.stringify({ error: { type: "not_found_error", message: "model: claude-old" } }),
      "claude-old"
    );
    expect(result.code).toBe("model");
    expect(result.message).toContain("ANTHROPIC_MODEL");
  });
});

describe("error predicates", () => {
  it("recognizes model errors from a normalized code", () => {
    expect(isModelError(new AiError("anything", 400, "model"))).toBe(true);
    expect(isModelError(new AiError("anything", 400, "quota"))).toBe(false);
  });

  it("falls back to the upstream text when no code is set", () => {
    expect(
      isModelError(new AiError("model `x` has been decommissioned", 400))
    ).toBe(true);
    expect(isModelError(new AiError("model `x` does not exist", 404))).toBe(true);
    expect(isModelError(new AiError("the request body does not exist", 400))).toBe(false);
    // A retired model is a 400/404, never a throttle.
    expect(isModelError(new AiError("model overloaded", 429))).toBe(false);
  });

  it("recognizes quota and rate-limit errors", () => {
    expect(isQuotaError(new AiError("x", 429))).toBe(true);
    expect(isQuotaError(new AiError("x", 400, "quota"))).toBe(true);
    expect(isQuotaError(new AiError("insufficient credit"))).toBe(true);
    expect(isQuotaError(new AiError("bad request", 400))).toBe(false);
    expect(isQuotaError("not an error")).toBe(false);
  });

  it("only moves to the next provider for provider-specific failures", () => {
    expect(shouldTryNextProvider(new AiError("x", 429))).toBe(true);
    expect(shouldTryNextProvider(new AiError("x", 404, "model"))).toBe(true);
    // A malformed prompt fails identically everywhere — surface it instead.
    expect(shouldTryNextProvider(new AiError("messages must not be empty", 400))).toBe(false);
    expect(shouldTryNextProvider(new AiError("provider is down", 500))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Health reporting                                                    */
/* ------------------------------------------------------------------ */

describe("AI health reporting", () => {
  const env = { ...process.env };

  beforeEach(() => {
    for (const id of AI_PROVIDER_IDS) delete process.env[getProviderConfig(id).keyEnvVar];
    delete process.env.AI_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("reports configured providers with their model ids and never a key", async () => {
    process.env.GROQ_API_KEY = "gsk_super_secret";
    const { getAiHealth } = await import("@/lib/ai/health");

    const health = await getAiHealth();
    const groq = health.providers.find((p) => p.provider === "groq")!;
    const openai = health.providers.find((p) => p.provider === "openai")!;

    expect(groq.configured).toBe(true);
    expect(groq.model).toBe(getProviderConfig("groq").model);
    expect(openai.configured).toBe(false);
    expect(openai.model).toBeUndefined();
    expect(JSON.stringify(health)).not.toContain("gsk_super_secret");
  });

  it("names the default provider the same way the client factory picks it", async () => {
    const { getAiHealth } = await import("@/lib/ai/health");
    expect((await getAiHealth()).defaultProvider).toBeNull();

    process.env.OPENAI_API_KEY = "sk_x";
    expect((await getAiHealth()).defaultProvider).toBe("openai");

    // Groq is preferred over paid providers once it has a key.
    process.env.GROQ_API_KEY = "gsk_x";
    expect((await getAiHealth()).defaultProvider).toBe("groq");

    // An explicit AI_PROVIDER wins, but only when that provider is configured.
    process.env.AI_PROVIDER = "anthropic";
    expect((await getAiHealth()).defaultProvider).toBe("groq");
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    expect((await getAiHealth()).defaultProvider).toBe("anthropic");
  });

  it("does not call the provider unless a probe is requested", async () => {
    process.env.GROQ_API_KEY = "gsk_x";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAiHealth } = await import("@/lib/ai/health");
    await getAiHealth();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes the models endpoint with the key and reports reachability", async () => {
    process.env.GROQ_API_KEY = "gsk_x";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { getAiHealth } = await import("@/lib/ai/health");
    const health = await getAiHealth({ probe: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer gsk_x" } })
    );
    expect(health.providers.find((p) => p.provider === "groq")!.reachable).toBe(true);
  });

  it("reports a failed probe as a status code without the response body", async () => {
    process.env.GROQ_API_KEY = "gsk_x";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const { getAiHealth } = await import("@/lib/ai/health");
    const groq = (await getAiHealth({ probe: true })).providers.find(
      (p) => p.provider === "groq"
    )!;
    expect(groq.reachable).toBe(false);
    expect(groq.probeError).toBe("HTTP 401");
  });

  it("survives a network failure during the probe", async () => {
    process.env.GROQ_API_KEY = "gsk_x";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const { getAiHealth } = await import("@/lib/ai/health");
    const groq = (await getAiHealth({ probe: true })).providers.find(
      (p) => p.provider === "groq"
    )!;
    expect(groq.reachable).toBe(false);
    expect(groq.probeError).toBe("TypeError");
  });
});
