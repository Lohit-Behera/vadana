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
      llm_provider: "lm_studio",
      lm_base_url: "http://127.0.0.1:1234",
      model: "qwen",
      api_key: "",
      max_context_tokens: 128_000,
      chat_history: [],
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
      models_root: "",
      attachments_dir: "",
      knowledge_mode: "off",
      knowledge_selection: { folder_ids: [], file_ids: [] },
      knowledge_catalog: [],
      knowledge_revision: 0,
      knowledge_dir: "",
      knowledge_index_dir: "",
      chat_system_prompt: "",
    });
  });

  it("uses per-chat LLM override over global settings", () => {
    const cfg = settingsToVoiceConfig(
      { ...DEFAULT_VOICE_SETTINGS, model: "global-model", llmProvider: "lm_studio" },
      {
        knowledge: {
          mode: "off",
          selection: { folder_ids: [], file_ids: [] },
          catalog: [],
          revision: 0,
          chat_llm_provider: "ollama",
          chat_llm_base_url: "http://127.0.0.1:11434",
          chat_model: "llama3",
        },
      },
    );
    expect(cfg.llm_provider).toBe("ollama");
    expect(cfg.lm_base_url).toBe("http://127.0.0.1:11434");
    expect(cfg.model).toBe("llama3");
  });

  it("uses per-chat TTS override over global settings", () => {
    const cfg = settingsToVoiceConfig(
      { ...DEFAULT_VOICE_SETTINGS, supertonicVoice: "F2", supertonicLang: "en" },
      {
        knowledge: {
          mode: "off",
          selection: { folder_ids: [], file_ids: [] },
          catalog: [],
          revision: 0,
          chat_system_prompt: "",
          chat_supertonic_voice: "M3",
          chat_supertonic_lang: "hi",
        },
      },
    );
    expect(cfg.supertonic_voice).toBe("M3");
    expect(cfg.supertonic_lang).toBe("hi");
  });

  it("falls back to global TTS when chat override empty", () => {
    const cfg = settingsToVoiceConfig(
      { ...DEFAULT_VOICE_SETTINGS, supertonicVoice: "F2", supertonicLang: "en" },
      {
        knowledge: {
          mode: "off",
          selection: { folder_ids: [], file_ids: [] },
          catalog: [],
          revision: 0,
          chat_system_prompt: "",
          chat_supertonic_voice: "",
          chat_supertonic_lang: "",
        },
      },
    );
    expect(cfg.supertonic_voice).toBe("F2");
    expect(cfg.supertonic_lang).toBe("en");
  });

  it("passes knowledge config when provided", () => {
    const cfg = settingsToVoiceConfig(DEFAULT_VOICE_SETTINGS, {
      knowledge: {
        mode: "selected",
        selection: { folder_ids: ["a"], file_ids: ["b"] },
        catalog: [
          {
            id: "b",
            folder_id: "a",
            rel_path: "folders/a/x.md",
            filename: "x.md",
            enabled: true,
            folder_enabled: true,
            char_count: 10,
          },
        ],
        revision: 2,
        chat_system_prompt: "Be formal.",
      },
    });
    expect(cfg.knowledge_mode).toBe("selected");
    expect(cfg.chat_system_prompt).toBe("Be formal.");
    expect(cfg.knowledge_revision).toBe(2);
    expect(cfg.knowledge_catalog).toHaveLength(1);
  });

  it("passes attachments_dir when provided", () => {
    const cfg = settingsToVoiceConfig(DEFAULT_VOICE_SETTINGS, {
      attachmentsDir: "C:\\\\app\\\\attachments",
    });
    expect(cfg.attachments_dir).toBe("C:\\\\app\\\\attachments");
  });

  it("passes knowledge dirs when provided", () => {
    const cfg = settingsToVoiceConfig(DEFAULT_VOICE_SETTINGS, {
      knowledgeDir: "C:\\\\app\\\\knowledge",
      knowledgeIndexDir: "C:\\\\app\\\\knowledge\\\\index",
    });
    expect(cfg.knowledge_dir).toBe("C:\\\\app\\\\knowledge");
    expect(cfg.knowledge_index_dir).toBe("C:\\\\app\\\\knowledge\\\\index");
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
