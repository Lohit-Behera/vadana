import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "@/lib/tauri";

export type KnowledgeMode = "off" | "all_enabled" | "selected";

export type KnowledgeSelection = {
  folderIds: string[];
  fileIds: string[];
};

export type KnowledgeFolderRow = {
  id: string;
  name: string;
  enabled: number;
  created_at: number;
};

export type KnowledgeFileRow = {
  id: string;
  folder_id: string;
  filename: string;
  rel_path: string;
  mime: string;
  size_bytes: number;
  enabled: number;
  indexed_at: number | null;
  char_count: number;
  created_at: number;
};

export type KnowledgeFileMeta = {
  id: string;
  folderId: string;
  filename: string;
  relPath: string;
  mime: string;
  sizeBytes: number;
  enabled: boolean;
  indexedAt: number | null;
  charCount: number;
  createdAt: number;
};

export type ChatKnowledgeConfig = {
  mode: KnowledgeMode;
  selection: KnowledgeSelection;
};

const DB_URL = "sqlite:vadana.db";
let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!isTauri()) {
    throw new Error("Knowledge database requires the Tauri desktop app");
  }
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

function parseSelection(raw: string): KnowledgeSelection {
  try {
    const obj = JSON.parse(raw) as KnowledgeSelection;
    return {
      folderIds: Array.isArray(obj.folderIds) ? obj.folderIds.map(String) : [],
      fileIds: Array.isArray(obj.fileIds) ? obj.fileIds.map(String) : [],
    };
  } catch {
    return { folderIds: [], fileIds: [] };
  }
}

function rowToFile(row: KnowledgeFileRow): KnowledgeFileMeta {
  return {
    id: row.id,
    folderId: row.folder_id,
    filename: row.filename,
    relPath: row.rel_path,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    enabled: row.enabled !== 0,
    indexedAt: row.indexed_at,
    charCount: row.char_count,
    createdAt: row.created_at,
  };
}

export async function listKnowledgeFolders(): Promise<
  (KnowledgeFolderRow & { fileCount: number })[]
> {
  const db = await getDb();
  const folders = await db.select<KnowledgeFolderRow[]>(
    "SELECT id, name, enabled, created_at FROM knowledge_folders ORDER BY created_at ASC",
  );
  const counts = await db.select<{ folder_id: string; n: number }[]>(
    "SELECT folder_id, COUNT(*) as n FROM knowledge_files GROUP BY folder_id",
  );
  const countMap = new Map(counts.map((c) => [c.folder_id, c.n]));
  return folders.map((f) => ({
    ...f,
    fileCount: countMap.get(f.id) ?? 0,
  }));
}

export async function createKnowledgeFolder(name: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    "INSERT INTO knowledge_folders (id, name, enabled, created_at) VALUES ($1, $2, 1, $3)",
    [id, name.trim() || "Untitled folder", now],
  );
  return id;
}

export async function renameKnowledgeFolder(
  folderId: string,
  name: string,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE knowledge_folders SET name = $1 WHERE id = $2", [
    name.trim() || "Untitled folder",
    folderId,
  ]);
}

export async function deleteKnowledgeFolder(folderId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM knowledge_files WHERE folder_id = $1", [folderId]);
  await db.execute("DELETE FROM knowledge_folders WHERE id = $1", [folderId]);
}

export async function setKnowledgeFolderEnabled(
  folderId: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE knowledge_folders SET enabled = $1 WHERE id = $2", [
    enabled ? 1 : 0,
    folderId,
  ]);
}

export async function listKnowledgeFiles(
  folderId?: string,
): Promise<KnowledgeFileMeta[]> {
  const db = await getDb();
  const rows = folderId
    ? await db.select<KnowledgeFileRow[]>(
        "SELECT id, folder_id, filename, rel_path, mime, size_bytes, enabled, indexed_at, char_count, created_at FROM knowledge_files WHERE folder_id = $1 ORDER BY filename ASC",
        [folderId],
      )
    : await db.select<KnowledgeFileRow[]>(
        "SELECT id, folder_id, filename, rel_path, mime, size_bytes, enabled, indexed_at, char_count, created_at FROM knowledge_files ORDER BY created_at ASC",
      );
  return rows.map(rowToFile);
}

export async function insertKnowledgeFile(row: {
  id: string;
  folderId: string;
  filename: string;
  relPath: string;
  mime: string;
  sizeBytes: number;
  charCount?: number;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO knowledge_files (id, folder_id, filename, rel_path, mime, size_bytes, enabled, char_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)`,
    [
      row.id,
      row.folderId,
      row.filename,
      row.relPath,
      row.mime,
      row.sizeBytes,
      row.charCount ?? 0,
      now,
    ],
  );
}

export async function setKnowledgeFileEnabled(
  fileId: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE knowledge_files SET enabled = $1 WHERE id = $2", [
    enabled ? 1 : 0,
    fileId,
  ]);
}

export async function updateKnowledgeFileCharCount(
  fileId: string,
  charCount: number,
  indexedAt?: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE knowledge_files SET char_count = $1, indexed_at = $2 WHERE id = $3",
    [charCount, indexedAt ?? Date.now(), fileId],
  );
}

export async function deleteKnowledgeFile(fileId: string): Promise<KnowledgeFileMeta | null> {
  const db = await getDb();
  const rows = await db.select<KnowledgeFileRow[]>(
    "SELECT id, folder_id, filename, rel_path, mime, size_bytes, enabled, indexed_at, char_count, created_at FROM knowledge_files WHERE id = $1",
    [fileId],
  );
  const row = rows[0];
  if (!row) return null;
  await db.execute("DELETE FROM knowledge_files WHERE id = $1", [fileId]);
  return rowToFile(row);
}

export async function getChatKnowledge(chatId: string): Promise<ChatKnowledgeConfig> {
  const db = await getDb();
  const rows = await db.select<
    { knowledge_mode: string; knowledge_selection: string }[]
  >("SELECT knowledge_mode, knowledge_selection FROM chats WHERE id = $1", [chatId]);
  const row = rows[0];
  if (!row) {
    return { mode: "off", selection: { folderIds: [], fileIds: [] } };
  }
  const mode = row.knowledge_mode as KnowledgeMode;
  return {
    mode: mode === "all_enabled" || mode === "selected" ? mode : "off",
    selection: parseSelection(row.knowledge_selection),
  };
}

export async function setChatKnowledge(
  chatId: string,
  mode: KnowledgeMode,
  selection: KnowledgeSelection,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE chats SET knowledge_mode = $1, knowledge_selection = $2, updated_at = $3 WHERE id = $4",
    [mode, JSON.stringify(selection), Date.now(), chatId],
  );
}

export type KnowledgeCatalogEntry = {
  id: string;
  folder_id: string;
  rel_path: string;
  filename: string;
  enabled: boolean;
  folder_enabled: boolean;
  char_count: number;
  indexed_at: number;
  size_bytes: number;
};

/** Catalog sent to the voice sidecar on each config. */
export async function getKnowledgeCatalogForBackend(): Promise<
  KnowledgeCatalogEntry[]
> {
  const db = await getDb();
  const rows = await db.select<
    {
      id: string;
      folder_id: string;
      rel_path: string;
      filename: string;
      enabled: number;
      folder_enabled: number;
      char_count: number;
      indexed_at: number | null;
      size_bytes: number;
    }[]
  >(
    `SELECT f.id, f.folder_id, f.rel_path, f.filename, f.size_bytes,
            f.enabled as enabled, fo.enabled as folder_enabled,
            f.char_count, f.indexed_at
     FROM knowledge_files f
     JOIN knowledge_folders fo ON fo.id = f.folder_id
     ORDER BY f.created_at ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    folder_id: r.folder_id,
    rel_path: r.rel_path,
    filename: r.filename,
    enabled: r.enabled !== 0,
    folder_enabled: r.folder_enabled !== 0,
    char_count: r.char_count,
    indexed_at: r.indexed_at ?? 0,
    size_bytes: r.size_bytes,
  }));
}

/** Stable id for indexed library content; unchanged when only chat selection changes. */
export function computeKnowledgeLibraryFingerprint(
  catalog: KnowledgeCatalogEntry[],
): string {
  const parts = catalog
    .filter((e) => e.enabled && e.folder_enabled)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (e) =>
        `${e.id}:${e.char_count}:${e.indexed_at}:${e.size_bytes}:${e.enabled ? 1 : 0}:${e.folder_enabled ? 1 : 0}`,
    );
  if (parts.length === 0) return "";
  let hash = 0;
  const joined = parts.join("|");
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

let knowledgeRevision = 0;

export function bumpKnowledgeRevision(): number {
  knowledgeRevision += 1;
  return knowledgeRevision;
}

export function getKnowledgeRevision(): number {
  return knowledgeRevision;
}

/** Bump only when library files change (import, delete, enable, rebuild) — not chat selection. */
export function bumpKnowledgeLibraryRevision(): number {
  return bumpKnowledgeRevision();
}
