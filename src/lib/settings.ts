import { load } from "@tauri-apps/plugin-store";
import { isTauri } from "@/lib/tauri";

const STORE_PATH = "voice-settings.json";
const LS_KEY = "vadana.voice-settings";
/** Previous project name; migrated once on read. */
const LS_KEY_LEGACY = "local-live.voice-settings";

/** Shipped default; user can edit in Settings before starting a session. */
export const DEFAULT_VOICE_SYSTEM_PROMPT = [
  "You are a helpful English assistant. The user may speak to you or type. Their latest message may be speech-to-text (STT) or typed text.",
  "When the message is from STT, interpret charitably (accent, noise, filler, informal phrasing). When it is typed, follow their wording more literally unless it is obviously mistaken.",
  "Always answer what they asked and stay on topic. Do not change the subject or add unrelated tangents.",
  "Replies are read aloud by TTS: usually one to three short sentences, plain language. No markdown or bullet lists unless they clearly need detail.",
  "If you truly cannot infer what they want, ask one brief clarifying question. Do not refuse with vague non-answers when a reasonable reply is still possible.",
  "Do not mention Whisper, transcription, or that you are an AI unless they ask.",
  "If they ask which model you are, answer briefly in neutral terms; do not recite marketing blurbs or long vendor descriptions unless they explicitly ask for details.",
].join("\n\n");

export type LlmProvider =
  | "lm_studio"
  | "openai"
  | "anthropic"
  | "ollama"
  | "groq";

export type VoiceSettings = {
  llmProvider: LlmProvider;
  lmBaseUrl: string;
  model: string;
  maxContextTokens: number;
  pushToTalk: boolean;
  inputGain: number;
  vadSensitivity: number;
  systemPrompt: string;
  piperModel: string;
  whisperModel: string;
  vadBargeIn: boolean;
  supertonicVoice: string;
  supertonicLang: string;
  supertonicModel: string;
  /** Reserved for future LiteLLM vector_store_ids / RAG integration. */
  vectorStoreIds: string[];
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  llmProvider: "lm_studio",
  lmBaseUrl: "http://127.0.0.1:1234",
  model: "local-model",
  maxContextTokens: 128_000,
  pushToTalk: false,
  inputGain: 1,
  vadSensitivity: 0.5,
  systemPrompt: DEFAULT_VOICE_SYSTEM_PROMPT,
  piperModel: "",
  whisperModel: "small",
  vadBargeIn: false,
  supertonicVoice: "",
  supertonicLang: "en",
  supertonicModel: "supertonic-3",
  vectorStoreIds: [],
};

function fromLocalStorage(): VoiceSettings | null {
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      raw = localStorage.getItem(LS_KEY_LEGACY);
      if (raw) {
        localStorage.setItem(LS_KEY, raw);
        localStorage.removeItem(LS_KEY_LEGACY);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
  } catch {
    return null;
  }
}

function toLocalStorage(settings: VoiceSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(settings));
}

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  const fromLs = fromLocalStorage();
  if (!isTauri()) {
    return fromLs ?? { ...DEFAULT_VOICE_SETTINGS };
  }
  try {
    const store = await load(STORE_PATH, { autoSave: false, defaults: {} });
    const saved = await store.get<Partial<VoiceSettings>>("settings");
    if (saved && typeof saved === "object") {
      return { ...DEFAULT_VOICE_SETTINGS, ...saved };
    }
  } catch {
    /* plugin-store unavailable — fall back */
  }
  return fromLs ?? { ...DEFAULT_VOICE_SETTINGS };
}

export async function saveVoiceSettings(settings: VoiceSettings): Promise<void> {
  toLocalStorage(settings);
  if (!isTauri()) return;
  try {
    const store = await load(STORE_PATH, { autoSave: false, defaults: {} });
    await store.set("settings", settings);
    await store.save();
  } catch {
    /* localStorage already saved */
  }
}
