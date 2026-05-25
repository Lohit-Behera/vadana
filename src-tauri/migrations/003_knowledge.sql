CREATE TABLE IF NOT EXISTS knowledge_folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT NOT NULL REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  indexed_at INTEGER,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_folder ON knowledge_files(folder_id);

ALTER TABLE chats ADD COLUMN knowledge_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE chats ADD COLUMN knowledge_selection TEXT NOT NULL DEFAULT '{"folderIds":[],"fileIds":[]}';
