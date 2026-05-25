import { listen, isTauri } from "@/lib/tauri";

export type KnowledgeRebuildEvent = {
  type: string;
  message?: string;
  phase?: string;
  percent?: number;
  ok?: boolean;
  docCount?: number;
  nodeCount?: number;
  error?: string;
  charUpdates?: { id: string; charCount: number }[];
};

/** Wait until the Tauri event listener is active (avoids missing early progress). */
export async function listenKnowledgeRebuild(
  handler: (ev: KnowledgeRebuildEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen<KnowledgeRebuildEvent>("knowledge-rebuild", (e) => {
    handler(e.payload);
  });
}

/** @deprecated Use listenKnowledgeRebuild and await it before invoke. */
export function onKnowledgeRebuild(
  handler: (ev: KnowledgeRebuildEvent) => void,
): () => void {
  let unlisten: (() => void) | undefined;
  void listenKnowledgeRebuild(handler).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}
