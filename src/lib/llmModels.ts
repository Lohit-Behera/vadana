import { invoke, isTauri } from "@/lib/tauri";
import type { LlmProvider } from "@/lib/settings";
import { getProviderApiKey, providerNeedsApiKey } from "@/lib/keychain";

export type ListedModel = {
  id: string;
  provider: string;
};

export async function listLlmModels(opts: {
  provider: LlmProvider;
  baseUrl: string;
}): Promise<ListedModel[]> {
  if (!isTauri()) return [];
  let apiKey: string | undefined;
  if (providerNeedsApiKey(opts.provider)) {
    const key = await getProviderApiKey(opts.provider);
    apiKey = key.trim() || undefined;
  }
  return invoke<ListedModel[]>("list_llm_models", {
    provider: opts.provider,
    baseUrl: opts.baseUrl.trim() || null,
    apiKey: apiKey ?? null,
  });
}
