import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { useChats } from "@/hooks/useChats";
import type { useVoiceSession } from "@/hooks/useVoiceSession";
import {
  listKnowledgeFiles,
  listKnowledgeFolders,
  type KnowledgeMode,
} from "@/lib/knowledgeDb";

type Chats = ReturnType<typeof useChats>;
type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  chats: Chats;
  v: Voice;
};

export function ChatKnowledgePicker({ chats, v }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<KnowledgeMode>("off");
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [folders, setFolders] = useState<
    Awaited<ReturnType<typeof listKnowledgeFolders>>
  >([]);
  const [allFiles, setAllFiles] = useState<
    Awaited<ReturnType<typeof listKnowledgeFiles>>
  >([]);

  const load = useCallback(async () => {
    const [f, files, cfg] = await Promise.all([
      listKnowledgeFolders(),
      listKnowledgeFiles(),
      chats.getChatKnowledge(),
    ]);
    setFolders(f);
    setAllFiles(files);
    setMode(cfg.mode);
    setFolderIds(cfg.selection.folderIds);
    setFileIds(cfg.selection.fileIds);
  }, [chats]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    void load();
  }, [chats.activeChatId, load]);

  const persist = useCallback(
    async (nextMode: KnowledgeMode, fIds: string[], fiIds: string[]) => {
      await chats.updateChatKnowledge(nextMode, {
        folderIds: fIds,
        fileIds: fiIds,
      });
      await load();
      if (v.sessionActive) {
        await v.reloadSessionConfig();
        toast.success("Knowledge settings applied to this session");
      } else {
        toast.message("Knowledge saved for this chat", {
          description: "Start the session to use it in voice chat.",
        });
      }
    },
    [chats, load, v],
  );

  const label =
    mode === "off"
      ? "Knowledge off"
      : mode === "all_enabled"
        ? "All knowledge"
        : `Selected (${folderIds.length + fileIds.length})`;

  const toggleAllEnabled = useCallback(
    (on: boolean) => {
      const next: KnowledgeMode = on ? "all_enabled" : "off";
      setMode(next);
      setFolderIds([]);
      setFileIds([]);
      void persist(next, [], []);
    },
    [persist],
  );

  const toggleFile = useCallback(
    (fileId: string, folderId: string, checked: boolean) => {
      const nextFiles = checked
        ? [...fileIds, fileId]
        : fileIds.filter((id) => id !== fileId);
      let nextFolders = folderIds;
      if (checked && !folderIds.includes(folderId)) {
        nextFolders = [...folderIds, folderId];
      }
      const nextMode: KnowledgeMode =
        nextFiles.length || nextFolders.length ? "selected" : "off";
      setMode(nextMode);
      setFolderIds(nextFolders);
      setFileIds(nextFiles);
      void persist(nextMode, nextFolders, nextFiles);
    },
    [fileIds, folderIds, persist],
  );

  const toggleFolder = useCallback(
    (folderId: string, checked: boolean) => {
      const filesInFolder = allFiles
        .filter((f) => f.folderId === folderId)
        .map((f) => f.id);
      let nextFolders = checked
        ? [...folderIds, folderId]
        : folderIds.filter((id) => id !== folderId);
      let nextFiles = checked
        ? [...new Set([...fileIds, ...filesInFolder])]
        : fileIds.filter((id) => !filesInFolder.includes(id));
      const nextMode: KnowledgeMode =
        nextFiles.length || nextFolders.length ? "selected" : "off";
      setMode(nextMode);
      setFolderIds(nextFolders);
      setFileIds(nextFiles);
      void persist(nextMode, nextFolders, nextFiles);
    },
    [allFiles, fileIds, folderIds, persist],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={mode === "off" ? "outline" : "default"}
          size="sm"
          className="gap-1.5"
        >
          <BookOpen className="size-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="start">
        <DropdownMenuLabel>Reference knowledge</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-3 px-2 py-1">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Use all library files</span>
            <Switch checked={mode === "all_enabled"} onCheckedChange={toggleAllEnabled} />
          </label>

          <p className="text-muted-foreground text-xs">
            Or check folders/files for this chat only (e.g. your resume):
          </p>

          <div className="max-h-48 space-y-2 overflow-y-auto">
            {folders.map((folder) => (
              <div key={folder.id}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={
                      mode === "selected" &&
                      (folderIds.includes(folder.id) ||
                        allFiles
                          .filter((f) => f.folderId === folder.id)
                          .every((f) => fileIds.includes(f.id)))
                    }
                    disabled={mode === "all_enabled"}
                    onChange={(e) => toggleFolder(folder.id, e.target.checked)}
                  />
                  {folder.name}
                </label>
                <ul className="ml-5 mt-1 space-y-1">
                  {allFiles
                    .filter((f) => f.folderId === folder.id)
                    .map((file) => (
                      <li key={file.id}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={mode === "selected" && fileIds.includes(file.id)}
                            disabled={mode === "all_enabled"}
                            onChange={(e) =>
                              toggleFile(file.id, folder.id, e.target.checked)
                            }
                          />
                          <span className="truncate">{file.filename}</span>
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>

          {folders.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Add documents in Knowledge from the sidebar.
            </p>
          )}

          {mode === "off" && allFiles.length > 0 && (
            <p className="text-amber-600 text-xs dark:text-amber-400">
              Knowledge is off — check your resume file (or turn on Use all enabled),
              then ask again.
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
