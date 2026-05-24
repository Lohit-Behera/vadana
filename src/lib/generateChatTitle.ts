import { invoke, isTauri } from "@/lib/tauri";
import { loadVoiceSettings, DEFAULT_VOICE_SETTINGS } from "@/lib/settings";

export type TitleMessage = { role: "user" | "assistant"; text: string };

const LOG_PREFIX = "[Vadana:chat-title]";

function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args);
}

function logWarn(...args: unknown[]): void {
  console.warn(LOG_PREFIX, ...args);
}

export type GenerateChatTitleResult = {
  title: string | null;
  http_status: number;
  response_body: string;
  error: string | null;
  used_fallback: boolean;
};

function stripForTitle(text: string): string {
  return text
    .replace(/<breath\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeGeneratedTitle(raw: string): string {
  let t = raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
  if (!t) return "New chat";
  if (t.length > 48) t = `${t.slice(0, 48).trim()}…`;
  return t;
}

function fallbackTitle(messages: TitleMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.text ?? "";
  const t = stripForTitle(first);
  if (!t) return "New chat";
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

function buildSnippet(messages: TitleMessage[]): string {
  const user = messages.find((m) => m.role === "user");
  const assistant = messages.find((m) => m.role === "assistant");
  const parts: string[] = [];
  if (user?.text) parts.push(`User: ${stripForTitle(user.text)}`);
  if (assistant?.text) parts.push(`Assistant: ${stripForTitle(assistant.text)}`);
  return parts.join("\n");
}

/** Pull assistant text from OpenAI-style JSON (for tests / browser fallback). */
export function extractOpenAiTitleText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown> | undefined;
  if (message) {
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  const text = choice.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  return null;
}

function logTitleResult(result: GenerateChatTitleResult): void {
  log("Rust/invoke result", {
    http_status: result.http_status,
    error: result.error,
    title: result.title,
    used_fallback: result.used_fallback,
  });
  if (result.response_body) {
    try {
      const parsed = JSON.parse(result.response_body) as unknown;
      log("Response JSON (parsed)", parsed);
      if (parsed && typeof parsed === "object" && "usage" in (parsed as object)) {
        log("Token usage", (parsed as { usage?: unknown }).usage);
      }
    } catch {
      log("Response body (raw)", result.response_body.slice(0, 2000));
    }
  }
}

async function titleViaTauri(snippet: string): Promise<GenerateChatTitleResult | null> {
  if (!isTauri()) return null;
  const settings = await loadVoiceSettings();
  const provider = settings.llmProvider ?? DEFAULT_VOICE_SETTINGS.llmProvider;
  const model = settings.model ?? DEFAULT_VOICE_SETTINGS.model;
  const lmBaseUrl = settings.lmBaseUrl ?? DEFAULT_VOICE_SETTINGS.lmBaseUrl;

  log("Invoking Rust generate_chat_title (no CORS)", {
    provider,
    model,
    lmBaseUrl,
    snippetPreview: snippet.slice(0, 200),
  });

  const result = await invoke<GenerateChatTitleResult>("generate_chat_title", {
    provider,
    model,
    lmBaseUrl,
    snippet,
  });

  logTitleResult(result);
  return result;
}

/** Ask the configured LLM for a short sidebar title; falls back to truncated first user line. */
export async function generateChatTitle(messages: TitleMessage[]): Promise<string> {
  log("generateChatTitle called", { messageCount: messages.length });

  if (messages.length === 0) return "New chat";

  const snippet = buildSnippet(messages);
  if (!snippet) {
    logWarn("Empty snippet — fallback");
    return fallbackTitle(messages);
  }

  try {
    const rust = await titleViaTauri(snippet);
    if (rust?.title && rust.title !== "New chat") {
      log("Using AI title from Rust proxy", rust.title);
      return rust.title;
    }
    if (rust?.error) {
      logWarn("Rust title error", rust.error);
    }
  } catch (err) {
    logWarn("invoke generate_chat_title failed", err);
  }

  const fb = fallbackTitle(messages);
  logWarn("Using fallback title (first user line)", fb);
  return fb;
}
