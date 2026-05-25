import { invoke, isTauri } from "@/lib/tauri";

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED = [".md", ".pdf", ".docx", ".xlsx"];

export type ImportedKnowledgeFile = {
  id: string;
  relPath: string;
  absolutePath: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

function allowedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ALLOWED.some((ext) => lower.endsWith(ext));
}

export async function importKnowledgeFile(
  folderId: string,
  file: File,
): Promise<ImportedKnowledgeFile> {
  if (!isTauri()) {
    throw new Error("Knowledge import requires the Vadana desktop app");
  }
  if (!allowedFile(file)) {
    throw new Error("Supported types: .md, .pdf, .docx, .xlsx");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit`);
  }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const raw = await invoke<{
    id: string;
    relPath: string;
    absolutePath: string;
    filename: string;
    mime: string;
    sizeBytes: number;
  }>("import_knowledge_file", {
    folderId,
    filename: file.name,
    bytes,
  });
  return {
    id: raw.id,
    relPath: raw.relPath,
    absolutePath: raw.absolutePath,
    filename: raw.filename,
    mime: raw.mime,
    sizeBytes: raw.sizeBytes,
  };
}

export async function ensureKnowledgeFolder(folderId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ensure_knowledge_folder", { folderId });
}

export async function deleteKnowledgeFileOnDisk(relPath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_knowledge_file_on_disk", { relPath });
}
