import { invoke, isTauri, listen } from "@/lib/tauri";

export type SupertonicModelStatus = {
  present: boolean;
  model: string;
  cacheDir: string;
  message: string;
};

export type SupertonicDownloadEvent = {
  type: string;
  percent?: number;
  message?: string;
  present?: boolean;
  alreadyPresent?: boolean;
  cacheDir?: string;
};

export async function checkSupertonicModel(
  model: string,
  modelsRoot?: string,
): Promise<SupertonicModelStatus | null> {
  if (!isTauri()) return null;
  return invoke<SupertonicModelStatus>("check_supertonic_model", {
    model,
    modelsRoot: modelsRoot?.trim() || null,
  });
}

export async function startSupertonicDownload(
  model: string,
  modelsRoot?: string,
): Promise<void> {
  await invoke("download_supertonic_model", {
    model,
    modelsRoot: modelsRoot?.trim() || null,
  });
}

export function onSupertonicDownload(
  handler: (ev: SupertonicDownloadEvent) => void,
): () => void {
  if (!isTauri()) return () => {};
  let unlistenFn: (() => void) | undefined;
  void listen<SupertonicDownloadEvent>("supertonic-download", (e) => {
    handler(e.payload);
  }).then((fn) => {
    unlistenFn = fn;
  });
  return () => unlistenFn?.();
}
