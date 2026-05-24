import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "@/lib/settings";

const LS_KEY = "vadana.voice-settings";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
}));

describe("voice settings (browser)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns defaults when storage is empty", async () => {
    const s = await loadVoiceSettings();
    expect(s).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("merges partial saved settings with defaults", async () => {
    const partial: Partial<VoiceSettings> = {
      model: "my-local-model",
      whisperModel: "tiny",
    };
    localStorage.setItem(LS_KEY, JSON.stringify(partial));
    const s = await loadVoiceSettings();
    expect(s.model).toBe("my-local-model");
    expect(s.whisperModel).toBe("tiny");
    expect(s.lmBaseUrl).toBe(DEFAULT_VOICE_SETTINGS.lmBaseUrl);
  });

  it("returns defaults when localStorage JSON is invalid", async () => {
    localStorage.setItem(LS_KEY, "{not json");
    const s = await loadVoiceSettings();
    expect(s).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("migrates legacy local-live storage key", async () => {
    const legacy = JSON.stringify({ model: "legacy-model" });
    localStorage.setItem("local-live.voice-settings", legacy);
    const s = await loadVoiceSettings();
    expect(s.model).toBe("legacy-model");
    expect(localStorage.getItem(LS_KEY)).toBe(legacy);
    expect(localStorage.getItem("local-live.voice-settings")).toBeNull();
  });

  it("persists settings to localStorage", async () => {
    const custom: VoiceSettings = {
      ...DEFAULT_VOICE_SETTINGS,
      lmBaseUrl: "http://127.0.0.1:9999",
      pushToTalk: true,
    };
    await saveVoiceSettings(custom);
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as VoiceSettings;
    expect(parsed.lmBaseUrl).toBe("http://127.0.0.1:9999");
    expect(parsed.pushToTalk).toBe(true);
  });
});
