import {
  invoke as tauriInvoke,
  isTauri as checkIsTauri,
} from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

export function isTauri(): boolean {
  return checkIsTauri();
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error(
      "This feature needs the desktop app. Close the browser tab and run: pnpm tauri dev",
    );
  }
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return tauriListen<T>(event, handler);
}
