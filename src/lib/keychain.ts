import { invoke, isTauri } from "@/lib/tauri";
import type { LlmProvider } from "@/lib/settings";

const KEYCHAIN_PROVIDERS: LlmProvider[] = [
  "openai",
  "anthropic",
  "groq",
  "openrouter",
];

export function providerNeedsApiKey(provider: LlmProvider): boolean {
  return KEYCHAIN_PROVIDERS.includes(provider);
}

export async function setProviderApiKey(
  provider: LlmProvider,
  key: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_provider_api_key", { provider, key });
}

export async function getProviderApiKey(provider: LlmProvider): Promise<string> {
  if (!isTauri()) return "";
  try {
    return await invoke<string>("get_provider_api_key", { provider });
  } catch {
    return "";
  }
}

export async function deleteProviderApiKey(provider: LlmProvider): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_provider_api_key", { provider });
}

export async function hasProviderApiKey(provider: LlmProvider): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("has_provider_api_key", { provider });
}
