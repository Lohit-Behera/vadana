import { invoke, isTauri, listen } from "@/lib/tauri";

/** Voice session WebSocket via Rust (avoids WebView blocking ws:// on some setups). */
export async function connectVoiceBridge(
  port: number,
  onMessage: (raw: string) => void,
): Promise<() => void> {
  if (!isTauri()) {
    throw new Error("Voice bridge requires the desktop app.");
  }

  const unlisten = await listen<string>("voice-backend-msg", (ev) => {
    onMessage(ev.payload);
  });

  try {
    // Blocks in Rust until the backend sends `ready` (or times out).
    await invoke("voice_ws_connect", { port });
  } catch (e) {
    unlisten();
    throw e;
  }

  return unlisten;
}

export function sendVoiceBridge(message: string): Promise<void> {
  return invoke("voice_ws_send", { message });
}

export function disconnectVoiceBridge(): Promise<void> {
  return invoke("voice_ws_disconnect");
}
