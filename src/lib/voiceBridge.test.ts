import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectVoiceBridge,
  disconnectVoiceBridge,
  sendVoiceBridge,
} from "@/lib/voiceBridge";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invoke(...args),
  listen: (...args: unknown[]) => listen(...args),
}));

describe("voiceBridge", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockResolvedValue(() => {});
    invoke.mockResolvedValue(undefined);
  });

  it("connectVoiceBridge registers listener then invokes voice_ws_connect", async () => {
    const onMessage = vi.fn();
    const unlisten = await connectVoiceBridge(8765, onMessage);

    expect(listen).toHaveBeenCalledWith("voice-backend-msg", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("voice_ws_connect", { port: 8765 });
    expect(typeof unlisten).toBe("function");
  });

  it("unsubscribes when voice_ws_connect fails", async () => {
    const cleanup = vi.fn();
    listen.mockResolvedValue(cleanup);
    invoke.mockRejectedValueOnce(new Error("timeout"));

    await expect(connectVoiceBridge(8765, vi.fn())).rejects.toThrow("timeout");
    expect(cleanup).toHaveBeenCalled();
  });

  it("sendVoiceBridge and disconnectVoiceBridge invoke Rust commands", async () => {
    await sendVoiceBridge('{"type":"start"}');
    await disconnectVoiceBridge();
    expect(invoke).toHaveBeenCalledWith("voice_ws_send", {
      message: '{"type":"start"}',
    });
    expect(invoke).toHaveBeenCalledWith("voice_ws_disconnect");
  });
});
