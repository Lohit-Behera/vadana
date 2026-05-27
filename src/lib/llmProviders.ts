import type { LlmProvider } from "@/lib/settings";

export type LlmProviderOption = {
  id: LlmProvider;
  label: string;
};

export const LLM_PROVIDERS: LlmProviderOption[] = [
  { id: "lm_studio", label: "LM Studio" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "ollama", label: "Ollama" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
];

export const LLM_DEFAULT_VALUE = "__default__";
export const LLM_MODEL_DEFAULT_VALUE = "__model_default__";
export const LLM_MODEL_CUSTOM_VALUE = "__custom__";

export function toSelectModelValue(stored: string): string {
  const id = stored.trim();
  return id.length > 0 ? id : LLM_MODEL_DEFAULT_VALUE;
}

export function fromSelectModelValue(value: string): string {
  return value === LLM_MODEL_DEFAULT_VALUE ? "" : value.trim();
}

export function defaultBaseUrlForProvider(provider: LlmProvider): string {
  switch (provider) {
    case "ollama":
      return "http://127.0.0.1:11434";
    case "openai":
      return "https://api.openai.com/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "anthropic":
      return "";
    default:
      return "http://127.0.0.1:1234";
  }
}

export function isLlmProvider(value: string): value is LlmProvider {
  return LLM_PROVIDERS.some((p) => p.id === value);
}

export type ChatLlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
};

export type EffectiveLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
};

export function resolveEffectiveLlm(
  global: { llmProvider: LlmProvider; lmBaseUrl: string; model: string },
  chat: ChatLlmConfig,
): EffectiveLlmConfig {
  const chatProvider = chat.provider.trim();
  const hasChatProvider = chatProvider.length > 0 && isLlmProvider(chatProvider);
  const provider = hasChatProvider
    ? (chatProvider as LlmProvider)
    : global.llmProvider;
  const baseUrl =
    chat.baseUrl.trim() ||
    (hasChatProvider
      ? defaultBaseUrlForProvider(provider)
      : global.lmBaseUrl.trim() || defaultBaseUrlForProvider(provider));
  const model = chat.model.trim() || global.model.trim() || "local-model";
  return { provider, baseUrl, model };
}

export function providerLabel(provider: LlmProvider): string {
  return LLM_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

/** Short label for toolbar (strips path prefix, caps length). */
export function displayModelName(model: string, maxLen = 26): string {
  const trimmed = model.trim();
  if (!trimmed) return "Model";
  const base = trimmed.includes("/")
    ? (trimmed.split("/").pop() ?? trimmed)
    : trimmed;
  if (base.length <= maxLen) return base;
  return `${base.slice(0, maxLen - 1)}…`;
}
