import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderPlus, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { listenKnowledgeRebuild } from "@/lib/knowledgeRebuild";
import type { useVoiceSession } from "@/hooks/useVoiceSession";
import {
  bumpKnowledgeLibraryRevision,
  createKnowledgeFolder,
  deleteKnowledgeFile,
  deleteKnowledgeFolder,
  getKnowledgeCatalogForBackend,
  insertKnowledgeFile,
  listKnowledgeFiles,
  listKnowledgeFolders,
  renameKnowledgeFolder,
  setKnowledgeFileEnabled,
  setKnowledgeFolderEnabled,
  updateKnowledgeFileCharCount,
  type KnowledgeFileMeta,
} from "@/lib/knowledgeDb";
import {
  deleteKnowledgeFileOnDisk,
  ensureKnowledgeFolder,
  importKnowledgeFile,
} from "@/lib/knowledge";

type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  v: Voice;
  onBack: () => void;
};

export function KnowledgePage({ v, onBack }: Props) {
  const [folders, setFolders] = useState<
    Awaited<ReturnType<typeof listKnowledgeFolders>>
  >([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<KnowledgeFileMeta[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [importing, setImporting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [rebuildPercent, setRebuildPercent] = useState<number | null>(null);
  const [rebuildPhase, setRebuildPhase] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const phaseLabel: Record<string, string> = {
    start: "Starting",
    load: "Loading documents",
    parse: "Parsing (Docling)",
    download: "Embedding model",
    chunk: "Chunking",
    embed: "Indexing",
    persist: "Saving",
    done: "Complete",
    error: "Error",
  };

  const refreshFolders = useCallback(async () => {
    const rows = await listKnowledgeFolders();
    setFolders(rows);
    if (!activeFolderId && rows[0]) {
      setActiveFolderId(rows[0].id);
    }
  }, [activeFolderId]);

  const refreshFiles = useCallback(async (folderId: string | null) => {
    if (!folderId) {
      setFiles([]);
      return;
    }
    setFiles(await listKnowledgeFiles(folderId));
  }, []);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  useEffect(() => {
    void refreshFiles(activeFolderId);
  }, [activeFolderId, refreshFiles]);

  const onCreateFolder = useCallback(async () => {
    const name = newFolderName.trim() || "New folder";
    const id = await createKnowledgeFolder(name);
    await ensureKnowledgeFolder(id);
    bumpKnowledgeLibraryRevision();
    setNewFolderName("");
    setActiveFolderId(id);
    await refreshFolders();
    if (v.sessionActive) await v.reloadSessionConfig();
  }, [newFolderName, refreshFolders, v]);

  const onImport = useCallback(
    async (list: FileList | null) => {
      if (!list?.length || !activeFolderId) return;
      setImporting(true);
      try {
        for (const file of Array.from(list)) {
          const imported = await importKnowledgeFile(activeFolderId, file);
          await insertKnowledgeFile({
            id: imported.id,
            folderId: activeFolderId,
            filename: imported.filename,
            relPath: imported.relPath,
            mime: imported.mime,
            sizeBytes: imported.sizeBytes,
          });
        }
        bumpKnowledgeLibraryRevision();
        await refreshFiles(activeFolderId);
        await refreshFolders();
        if (v.sessionActive) await v.reloadSessionConfig();
        toast.success("Files imported");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [activeFolderId, refreshFiles, refreshFolders, v],
  );

  const onRebuildIndex = useCallback(async () => {
    const catalog = await getKnowledgeCatalogForBackend();
    const enabledCount = catalog.filter(
      (e) => e.enabled && e.folder_enabled,
    ).length;
    if (enabledCount === 0) {
      toast.error("Nothing to index", {
        description:
          "Turn on Enabled for the folder and for each file you want in the index.",
      });
      setIndexStatus(
        "Enable the folder and file toggle(s), then click Rebuild index.",
      );
      return;
    }

    setRebuilding(true);
    setRebuildPercent(2);
    setRebuildPhase("start");
    setIndexStatus("Preparing rebuild…");

    const unlisten = await listenKnowledgeRebuild((ev) => {
      if (ev.message) setIndexStatus(ev.message);
      if (typeof ev.percent === "number") setRebuildPercent(ev.percent);
      if (ev.phase) setRebuildPhase(ev.phase);
    });

    try {
      const result = await invoke<{
        ok: boolean;
        docCount: number;
        nodeCount: number;
        error?: string | null;
        charUpdates: { id: string; charCount: number }[];
      }>("rebuild_knowledge_index", { catalog });

      for (const u of result.charUpdates ?? []) {
        await updateKnowledgeFileCharCount(u.id, u.charCount);
      }

      if (result.ok) {
        const msg =
          result.docCount > 0
            ? `Index ready — ${result.docCount} document(s), ${result.nodeCount} chunk(s).`
            : "Index cleared — enable the folder and file(s), then rebuild.";
        setIndexStatus(msg);
        setRebuildPercent(100);
        setRebuildPhase("done");
        toast.success("Knowledge index rebuilt");
        bumpKnowledgeLibraryRevision();
        if (activeFolderId) await refreshFiles(activeFolderId);
        if (v.sessionActive) await v.reloadSessionConfig();
      } else {
        const err = result.error ?? "Rebuild failed";
        setIndexStatus(err);
        setRebuildPhase("error");
        toast.error("Index rebuild failed", { description: err });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIndexStatus(msg);
      setRebuildPhase("error");
      toast.error("Index rebuild failed", { description: msg });
    } finally {
      unlisten();
      setRebuilding(false);
    }
  }, [activeFolderId, refreshFiles, v]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold">Knowledge</h1>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-4 md:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              placeholder="New folder"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateFolder();
              }}
            />
            <Button type="button" size="icon" variant="outline" onClick={() => void onCreateFolder()}>
              <FolderPlus className="size-4" />
            </Button>
          </div>
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {folders.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    activeFolderId === f.id ? "bg-muted font-medium" : "hover:bg-muted/60"
                  }`}
                  onClick={() => setActiveFolderId(f.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="text-muted-foreground text-xs">{f.fileCount}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex min-h-0 flex-col gap-3">
          {activeFolderId && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const folder = folders.find((f) => f.id === activeFolderId);
                  if (!folder) return null;
                  return (
                    <>
                      <Input
                        className="max-w-xs"
                        defaultValue={folder.name}
                        key={folder.id}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== folder.name) {
                            void renameKnowledgeFolder(folder.id, name).then(() =>
                              refreshFolders(),
                            );
                          }
                        }}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={folder.enabled !== 0}
                          onCheckedChange={(on) => {
                            void setKnowledgeFolderEnabled(folder.id, on).then(async () => {
                              bumpKnowledgeLibraryRevision();
                              await refreshFolders();
                              if (v.sessionActive) await v.reloadSessionConfig();
                            });
                          }}
                        />
                        Enabled
                      </label>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          void (async () => {
                            const toRemove = await listKnowledgeFiles(folder.id);
                            for (const f of toRemove) {
                              await deleteKnowledgeFileOnDisk(f.relPath);
                            }
                            await deleteKnowledgeFolder(folder.id);
                            bumpKnowledgeLibraryRevision();
                            setActiveFolderId(null);
                            await refreshFolders();
                            if (v.sessionActive) await v.reloadSessionConfig();
                          })();
                        }}
                      >
                        Delete folder
                      </Button>
                    </>
                  );
                })()}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.pdf,.docx,.xlsx"
                  className="hidden"
                  onChange={(e) => void onImport(e.target.files)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 size-4" />
                  Import files
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={rebuilding}
                  onClick={() => void onRebuildIndex()}
                >
                  <RefreshCw
                    className={`mr-2 size-4 ${rebuilding ? "animate-spin" : ""}`}
                  />
                  Rebuild index
                </Button>
              </div>

              {(rebuilding || indexStatus) && (
                <div className="space-y-2">
                  {rebuilding && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {rebuildPhase
                            ? phaseLabel[rebuildPhase] ?? rebuildPhase
                            : "Working"}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {rebuildPercent ?? 0}%
                        </span>
                      </div>
                      <Progress value={rebuildPercent ?? 0} className="h-2" />
                    </div>
                  )}
                  {indexStatus && (
                    <p className="text-muted-foreground text-sm">{indexStatus}</p>
                  )}
                </div>
              )}

              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {files.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{file.filename}</p>
                      <p className="text-muted-foreground text-xs">
                        {(file.sizeBytes / 1024).toFixed(1)} KB
                        {file.charCount > 0 ? ` · ${file.charCount} chars` : ""}
                        {file.indexedAt ? " · indexed" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={file.enabled}
                        onCheckedChange={(on) => {
                          void setKnowledgeFileEnabled(file.id, on).then(async () => {
                            bumpKnowledgeLibraryRevision();
                            await refreshFiles(activeFolderId);
                            if (v.sessionActive) await v.reloadSessionConfig();
                          });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void (async () => {
                            const removed = await deleteKnowledgeFile(file.id);
                            if (removed) {
                              await deleteKnowledgeFileOnDisk(removed.relPath);
                            }
                            bumpKnowledgeLibraryRevision();
                            await refreshFiles(activeFolderId);
                            if (v.sessionActive) await v.reloadSessionConfig();
                          })();
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!activeFolderId && (
            <p className="text-muted-foreground text-sm">
              Create a folder to import documents (.md, .pdf, .docx, .xlsx).
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
