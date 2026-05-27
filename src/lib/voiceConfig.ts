import {
  defaultBaseUrlForProvider,
  isLlmProvider,
} from "@/lib/llmProviders";
import type { LlmProvider, VoiceSettings } from "@/lib/settings";

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
  /** Root for Whisper / Supertonic / torch hub caches (default ~/vadana/models). */
  models_root: string;
  /** Absolute path where Tauri stages image/PDF files for the sidecar. */
  attachments_dir: string;
  knowledge_mode: "off" | "all_enabled" | "selected";
  knowledge_selection: { folder_ids: string[]; file_ids: string[] };
  knowledge_catalog: {
    id: string;
    folder_id: string;
    rel_path: string;
    filename: string;
    enabled: boolean;
    folder_enabled: boolean;
    char_count: number;
  }[];
  knowledge_revision: number;
  /** App data knowledge root (fallback when LIVE_VOICE_KNOWLEDGE_DIR env is unset). */
  knowledge_dir: string;
  knowledge_index_dir: string;
  /** Per-chat system prompt addon (extends global prompt). */
  chat_system_prompt: string;
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
    knowledgeDir?: string;
    knowledgeIndexDir?: string;
    knowledge?: {
      mode: VoiceWsConfig["knowledge_mode"];
      selection: VoiceWsConfig["knowledge_selection"];
      catalog: VoiceWsConfig["knowledge_catalog"];
      revision: number;
      chat_system_prompt?: string;
      chat_supertonic_voice?: string;
      chat_supertonic_lang?: string;
      chat_llm_provider?: string;
      chat_llm_base_url?: string;
      chat_model?: string;
    };
  },
): VoiceWsConfig {
  const chatVoice = opts?.knowledge?.chat_supertonic_voice?.trim() ?? "";
  const chatLang = opts?.knowledge?.chat_supertonic_lang?.trim() ?? "";
  const chatProviderRaw = opts?.knowledge?.chat_llm_provider?.trim() ?? "";
  const chatBaseUrl = opts?.knowledge?.chat_llm_base_url?.trim() ?? "";
  const chatModel = opts?.knowledge?.chat_model?.trim() ?? "";
  const hasChatProvider =
    chatProviderRaw.length > 0 && isLlmProvider(chatProviderRaw);
  const llmProvider = (hasChatProvider ? chatProviderRaw : s.llmProvider) as LlmProvider;
  const lmBaseUrl =
    chatBaseUrl ||
    (hasChatProvider
      ? defaultBaseUrlForProvider(llmProvider)
      : s.lmBaseUrl);
  return {
    type: "config",
    llm_provider: llmProvider,
    lm_base_url: lmBaseUrl,
    model: chatModel || s.model,
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
    supertonic_voice: chatVoice || s.supertonicVoice.trim(),
    supertonic_lang: chatLang || s.supertonicLang.trim() || "en",
    supertonic_model: s.supertonicModel.trim() || "supertonic-3",
    models_root: s.modelsRoot.trim(),
    attachments_dir: opts?.attachmentsDir?.trim() ?? "",
    knowledge_mode: opts?.knowledge?.mode ?? "off",
    knowledge_selection: opts?.knowledge?.selection ?? {
      folder_ids: [],
      file_ids: [],
    },
    knowledge_catalog: opts?.knowledge?.catalog ?? [],
    knowledge_revision: opts?.knowledge?.revision ?? 0,
    knowledge_dir: opts?.knowledgeDir?.trim() ?? "",
    knowledge_index_dir: opts?.knowledgeIndexDir?.trim() ?? "",
    chat_system_prompt: opts?.knowledge?.chat_system_prompt?.trim() ?? "",
  };
}
