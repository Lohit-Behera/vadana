import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
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
  compact?: boolean;
};

export function ChatKnowledgePicker({ chats, v, compact = false }: Props) {
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

  const active = mode !== "off";

  const trigger = (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size={compact ? "icon-sm" : "sm"}
      className={cn("relative", compact ? "size-8" : "gap-1.5")}
    >
      <BookOpen className="size-3.5" />
      {!compact ? label : null}
      {compact && active ? (
        <span className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
      ) : null}
    </Button>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
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
            {folders.map((folder) => {
              const folderChecked =
                mode === "selected" &&
                (folderIds.includes(folder.id) ||
                  allFiles
                    .filter((f) => f.folderId === folder.id)
                    .every((f) => fileIds.includes(f.id)));
              return (
                <div key={folder.id}>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`knowledge-folder-${folder.id}`}
                      checked={folderChecked}
                      disabled={mode === "all_enabled"}
                      onCheckedChange={(checked) =>
                        toggleFolder(folder.id, checked === true)
                      }
                    />
                    <label
                      htmlFor={`knowledge-folder-${folder.id}`}
                      className="cursor-pointer text-sm font-medium leading-none"
                    >
                      {folder.name}
                    </label>
                  </div>
                  <ul className="ml-6 mt-1.5 space-y-1.5">
                    {allFiles
                      .filter((f) => f.folderId === folder.id)
                      .map((file) => (
                        <li key={file.id}>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`knowledge-file-${file.id}`}
                              checked={
                                mode === "selected" && fileIds.includes(file.id)
                              }
                              disabled={mode === "all_enabled"}
                              onCheckedChange={(checked) =>
                                toggleFile(file.id, folder.id, checked === true)
                              }
                            />
                            <label
                              htmlFor={`knowledge-file-${file.id}`}
                              className="text-muted-foreground cursor-pointer truncate text-xs leading-none"
                            >
                              {file.filename}
                            </label>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {folders.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Add documents in Knowledge from the sidebar.
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
