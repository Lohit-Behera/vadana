import type { VoiceSettings } from "@/lib/settings";

export type VoiceWsConfig = {
  type: "config";
  llm_provider: string;
  lm_base_url: string;
  model: string;
  api_key: string;
  max_context_tokens: number;
  chat_history: { role: string; content: string }[];
  push_to_talk: boolean;
  input_gain: number;
  vad_sensitivity: number;
  system_prompt: string;
  piper_model: string;
  whisper_model: string;
  vad_barge_in: boolean;
  supertonic_voice: string;
  supertonic_lang: string;
  supertonic_model: string;
  /** Absolute path where Tauri stages image/PDF files for the sidecar. */
  attachments_dir: string;
};

export function voiceWsUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

/** Maps UI settings to the Python WebSocket `config` message shape. */
export function settingsToVoiceConfig(
  s: VoiceSettings,
  opts?: {
    apiKey?: string;
    chatHistory?: { role: string; content: string }[];
    attachmentsDir?: string;
  },
): VoiceWsConfig {
  return {
    type: "config",
    llm_provider: s.llmProvider,
    lm_base_url: s.lmBaseUrl,
    model: s.model,
    api_key: opts?.apiKey ?? "",
    max_context_tokens: s.maxContextTokens,
    chat_history: opts?.chatHistory ?? [],
    push_to_talk: s.pushToTalk,
    input_gain: s.inputGain,
    vad_sensitivity: s.vadSensitivity,
    system_prompt: s.systemPrompt,
    piper_model: s.piperModel || "",
    whisper_model: s.whisperModel.trim() || "small",
    vad_barge_in: s.vadBargeIn,
    supertonic_voice: s.supertonicVoice.trim(),
    supertonic_lang: s.supertonicLang.trim() || "en",
    supertonic_model: s.supertonicModel.trim() || "supertonic-3",
    attachments_dir: opts?.attachmentsDir?.trim() ?? "",
  };
}
