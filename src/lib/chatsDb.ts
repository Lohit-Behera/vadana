import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "@/lib/tauri";

export type ChatRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  content_format: string;
  created_at: number;
};

export type ChatAttachmentMeta = {
  id: string;
  kind: "image" | "pdf";
  mime: string;
  filename: string;
  path: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachmentMeta[];
};

export type UserTurnPayload = {
  text: string;
  attachments?: ChatAttachmentMeta[];
};

type JsonV1Content = {
  format: "json_v1";
  text: string;
  attachments: ChatAttachmentMeta[];
};

function parseJsonV1Content(raw: string): JsonV1Content | null {
  try {
    const obj = JSON.parse(raw) as JsonV1Content;
    if (obj?.format === "json_v1") return obj;
  } catch {
    /* plain text */
  }
  return null;
}

export function serializeUserTurn(payload: UserTurnPayload): {
  content: string;
  content_format: "text" | "json_v1";
} {
  if (!payload.attachments?.length) {
    return { content: payload.text.trim(), content_format: "text" };
  }
  return {
    content: JSON.stringify({
      format: "json_v1",
      text: payload.text.trim(),
      attachments: payload.attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        mime: a.mime,
        filename: a.filename,
        path: a.path,
      })),
    }),
    content_format: "json_v1",
  };
}

function rowToChatMessage(row: MessageRow): ChatMessage {
  if (row.content_format === "json_v1" || row.content.trim().startsWith("{")) {
    const parsed = parseJsonV1Content(row.content);
    if (parsed) {
      const labels = parsed.attachments.map(
        (a) => `[${a.kind}: ${a.filename || a.id}]`,
      );
      const caption = parsed.text.trim();
      const text =
        caption && labels.length
          ? `${caption}\n${labels.join(" ")}`
          : caption || labels.join(" ");
      return {
        id: row.id,
        role: row.role,
        text,
        attachments: parsed.attachments,
      };
    }
  }
  return { id: row.id, role: row.role, text: row.content };
}

const DB_URL = "sqlite:vadana.db";
let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!isTauri()) {
    throw new Error("Chat database requires the Tauri desktop app");
  }
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

export async function listChats(): Promise<ChatRow[]> {
  const db = await getDb();
  return db.select<ChatRow[]>(
    "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC",
  );
}

export async function createChat(title = "New chat"): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    "INSERT INTO chats (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [id, title, now, now],
  );
  return id;
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const rows = await db.select<MessageRow[]>(
    "SELECT id, chat_id, role, content, content_format, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [chatId],
  );
  return rows.map(rowToChatMessage);
}

export async function getChatHistoryForBackend(
  chatId: string,
): Promise<{ role: string; content: string }[]> {
  const db = await getDb();
  const rows = await db.select<{ role: string; content: string; content_format: string }[]>(
    "SELECT role, content, content_format FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [chatId],
  );
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
  }));
}

/** Append transcript lines not yet stored (e.g. before "New chat"). */
export async function syncTranscriptToChat(
  chatId: string,
  lines: { role: "user" | "assistant"; text: string }[],
): Promise<void> {
  if (lines.length === 0) return;
  const existing = await getChatMessages(chatId);
  for (let i = existing.length; i < lines.length; i++) {
    const line = lines[i];
    await appendMessage(chatId, line.role, line.text);
  }
}

/** Persist a full in-memory transcript (used when SQLite has no rows yet). */
export async function saveFullTranscript(
  chatId: string,
  lines: { role: "user" | "assistant"; text: string }[],
): Promise<void> {
  if (lines.length === 0) return;
  const existing = await getChatMessages(chatId);
  if (existing.length === 0) {
    for (const line of lines) {
      await appendMessage(chatId, line.role, line.text);
    }
    return;
  }
  await syncTranscriptToChat(chatId, lines);
}

export async function appendMessage(
  chatId: string,
  role: "user" | "assistant",
  content: string,
  contentFormat: "text" | "json_v1" = "text",
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    "INSERT INTO messages (id, chat_id, role, content, content_format, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, chatId, role, content, contentFormat, now],
  );
  await db.execute("UPDATE chats SET updated_at = $1 WHERE id = $2", [now, chatId]);
  return id;
}

export async function getChatTitle(chatId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ title: string }[]>(
    "SELECT title FROM chats WHERE id = $1",
    [chatId],
  );
  return rows[0]?.title?.trim() || "New chat";
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chats SET title = $1, updated_at = $2 WHERE id = $3", [
    title.trim() || "New chat",
    Date.now(),
    chatId,
  ]);
}

export async function deleteChat(chatId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE chat_id = $1", [chatId]);
  await db.execute("DELETE FROM chats WHERE id = $1", [chatId]);
}

export async function searchChats(query: string): Promise<ChatRow[]> {
  const db = await getDb();
  const q = `%${query.trim()}%`;
  if (!query.trim()) {
    return listChats();
  }
  return db.select<ChatRow[]>(
    `SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at
     FROM chats c
     LEFT JOIN messages m ON m.chat_id = c.id
     WHERE c.title LIKE $1 OR m.content LIKE $1
     ORDER BY c.updated_at DESC`,
    [q],
  );
}
