import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { isTauri } from "@/lib/tauri";

const STORE_PATH = "voice-settings.json";
const LS_KEY = "vadana.voice-settings";
/** Previous project name; migrated once on read. */
const LS_KEY_LEGACY = "local-live.voice-settings";

/** Shipped default; user can edit in Settings before starting a session. */
export const DEFAULT_VOICE_SYSTEM_PROMPT = `You are a helpful voice assistant. The user may speak (speech-to-text) or type. For STT, interpret charitably (accent, noise, fillers). For typed input, follow their wording unless clearly wrong.

Always answer what they asked. Stay on topic. Replies are read aloud by Supertonic 3 TTS: one to three short sentences, conversational, plain language. No markdown, bullets, code fences, or stage directions in parentheses.

TTS expression tags (Supertonic 3 only, optional):
- You may embed these exact lowercase tags where a natural sound fits: <laugh>, <breath>, <sigh>.
- Place a tag after the phrase that motivates it. Most replies need no tags—use them only when emotion or pacing clearly calls for it (at most one tag per reply; two only for a strong shift such as surprise then relief).
- Never explain the tags, never list them, never quote them, and never use other tags or XML.
- Do not start a reply with a tag or split a tag across lines.

Examples (tags are optional, not required every time):
- "That's a clever idea—I hadn't thought of it that way."
- "That's a clever idea <laugh> I hadn't thought of it that way."
- "Give me a second <breath> okay, here's the short answer."
- "I'm sorry that was frustrating <sigh> let's fix it step by step."

If you cannot infer what they want, ask one brief clarifying question. Do not mention Whisper, transcription, Supertonic, or that you are an AI unless they ask.`;

export type LlmProvider =
  | "lm_studio"
  | "openai"
  | "anthropic"
  | "ollama"
  | "groq"
  | "openrouter";

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
  /** Root folder for Whisper / Supertonic weights (default: ~/vadana/models). */
  modelsRoot: string;
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
  supertonicVoice: "F2",
  supertonicLang: "en",
  supertonicModel: "supertonic-3",
  modelsRoot: "",
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
  try {
    await invoke("refresh_uninstall_paths");
  } catch {
    /* best-effort: manifest used by uninstaller */
  }
}
