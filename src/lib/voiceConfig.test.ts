import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/settings";
import { settingsToVoiceConfig, voiceWsUrl } from "@/lib/voiceConfig";

describe("voiceWsUrl", () => {
  it("builds localhost WebSocket URL", () => {
    expect(voiceWsUrl(8765)).toBe("ws://127.0.0.1:8765");
  });
});

describe("settingsToVoiceConfig", () => {
  it("maps camelCase UI fields to snake_case protocol fields", () => {
    const cfg = settingsToVoiceConfig({
      ...DEFAULT_VOICE_SETTINGS,
      lmBaseUrl: "http://127.0.0.1:1234",
      model: "qwen",
      pushToTalk: true,
      inputGain: 1.5,
      vadSensitivity: 0.8,
      systemPrompt: "Be brief.",
      piperModel: "/voices/en.onnx",
      whisperModel: "base",
      vadBargeIn: true,
      supertonicVoice: "M1",
      supertonicLang: "hi",
      supertonicModel: "supertonic-3",
    });
    expect(cfg).toEqual({
      type: "config",
      lm_base_url: "http://127.0.0.1:1234",
      model: "qwen",
      push_to_talk: true,
      input_gain: 1.5,
      vad_sensitivity: 0.8,
      system_prompt: "Be brief.",
      piper_model: "/voices/en.onnx",
      whisper_model: "base",
      vad_barge_in: true,
      supertonic_voice: "M1",
      supertonic_lang: "hi",
      supertonic_model: "supertonic-3",
    });
  });

  it("applies defaults for empty whisper and supertonic fields", () => {
    const cfg = settingsToVoiceConfig({
      ...DEFAULT_VOICE_SETTINGS,
      whisperModel: "   ",
      supertonicVoice: "  ",
      supertonicLang: "",
      supertonicModel: "",
    });
    expect(cfg.whisper_model).toBe("small");
    expect(cfg.supertonic_voice).toBe("");
    expect(cfg.supertonic_lang).toBe("en");
    expect(cfg.supertonic_model).toBe("supertonic-3");
  });
});
