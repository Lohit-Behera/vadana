import { invoke, isTauri } from "@/lib/tauri";

/** Empty string in settings → use this default from the shell. */
export async function getDefaultModelsRoot(): Promise<string> {
  if (!isTauri()) {
    return "";
  }
  return invoke<string>("default_models_root");
}

export async function pickModelsFolder(
  current?: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("pick_models_folder", {
    current: current?.trim() || null,
  });
}

export function effectiveModelsRoot(
  configured: string,
  fallback: string,
): string {
  const trimmed = configured.trim();
  return trimmed || fallback;
}
