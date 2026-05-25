/** Supertonic TTS language and voice options (settings UI). */

export type SupertonicLanguage = {
  code: string;
  label: string;
};

/** Sorted by English name for the settings dropdown. */
export const SUPERTONIC_LANGUAGES: SupertonicLanguage[] = [
  { code: "ar", label: "Arabic" },
  { code: "bg", label: "Bulgarian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "hi", label: "Hindi" },
  { code: "hr", label: "Croatian" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "lt", label: "Lithuanian" },
  { code: "lv", label: "Latvian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "sv", label: "Swedish" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

export type SupertonicVoice = {
  id: string;
  label: string;
  group: "female" | "male";
};

export const SUPERTONIC_VOICES: SupertonicVoice[] = [
  { id: "F1", label: "F1 — Female 1", group: "female" },
  { id: "F2", label: "F2 — Female 2", group: "female" },
  { id: "F3", label: "F3 — Female 3", group: "female" },
  { id: "F4", label: "F4 — Female 4", group: "female" },
  { id: "F5", label: "F5 — Female 5", group: "female" },
  { id: "M1", label: "M1 — Male 1", group: "male" },
  { id: "M2", label: "M2 — Male 2", group: "male" },
  { id: "M3", label: "M3 — Male 3", group: "male" },
  { id: "M4", label: "M4 — Male 4", group: "male" },
  { id: "M5", label: "M5 — Male 5", group: "male" },
];

const VOICE_IDS = new Set(SUPERTONIC_VOICES.map((v) => v.id));
const LANG_CODES = new Set(SUPERTONIC_LANGUAGES.map((l) => l.code));

export function normalizeSupertonicVoice(value: string): string {
  const id = value.trim().toUpperCase();
  return VOICE_IDS.has(id) ? id : "F2";
}

export function normalizeSupertonicLang(value: string): string {
  const code = value.trim().toLowerCase();
  return LANG_CODES.has(code) ? code : "en";
}

/** Radix Select value when using global Settings defaults for this chat. */
export const SUPERTONIC_DEFAULT_VALUE = "__default__";

export function toSelectVoiceValue(stored: string): string {
  const id = stored.trim().toUpperCase();
  return VOICE_IDS.has(id) ? id : SUPERTONIC_DEFAULT_VALUE;
}

export function fromSelectVoiceValue(select: string): string {
  return select === SUPERTONIC_DEFAULT_VALUE ? "" : select;
}

export function toSelectLangValue(stored: string): string {
  const code = stored.trim().toLowerCase();
  return LANG_CODES.has(code) ? code : SUPERTONIC_DEFAULT_VALUE;
}

export function fromSelectLangValue(select: string): string {
  return select === SUPERTONIC_DEFAULT_VALUE ? "" : select;
}
