import { useCallback, useState, type ReactNode } from "react";
import {
  BookOpen,
  MessageSquarePlus,
  MoreVertical,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { useChats } from "@/hooks/useChats";
import type { ChatRow } from "@/lib/chatsDb";

type Chats = ReturnType<typeof useChats>;

type Props = {
  chats: Chats;
  onOpenSettings: () => void;
  onOpenKnowledge: () => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onChatsDeleted?: () => void;
};

function ChatRowMenus({
  chat,
  onRename,
  onDelete,
  children,
}: {
  chat: ChatRow;
  onRename: (chat: ChatRow) => void;
  onDelete: (chatId: string) => void;
  children: ReactNode;
}) {
  const menuItems = (
    <>
      <ContextMenuItem onClick={() => onRename(chat)}>Rename</ContextMenuItem>
      <ContextMenuItem
        variant="destructive"
        onClick={() => onDelete(chat.id)}
      >
        <Trash2 className="mr-2 size-3.5" />
        Delete
      </ContextMenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{menuItems}</ContextMenuContent>
    </ContextMenu>
  );
}

export function AppSidebar({
  chats,
  onOpenSettings,
  onOpenKnowledge,
  onSelectChat,
  onNewChat,
  onChatsDeleted,
}: Props) {
  const [search, setSearch] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      void chats.search(q);
    },
    [chats],
  );

  const openRename = useCallback((chat: ChatRow) => {
    setRenameId(chat.id);
    setRenameTitle(chat.title);
  }, []);

  const deleteChats = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const activeId = chats.activeChatId;
      await chats.removeChats(ids);
      if (activeId && ids.includes(activeId)) {
        onChatsDeleted?.();
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (selectionMode && selectedIds.size === 0) {
        setSelectionMode(false);
      }
    },
    [chats, onChatsDeleted, selectionMode, selectedIds.size],
  );

  const toggleSelected = useCallback((chatId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(chatId);
      else next.delete(chatId);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(chats.chats.map((c) => c.id)));
  }, [chats.chats]);

  const deleteSelected = useCallback(() => {
    void deleteChats([...selectedIds]);
  }, [deleteChats, selectedIds]);

  return (
    <Sidebar>
      <SidebarHeader className="gap-2 p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold tracking-tight">Vadana</span>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-3.5" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search chats"
            className="h-9 pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center justify-between gap-1 px-2">
            <SidebarGroupLabel className="px-0">Recents</SidebarGroupLabel>
            {selectionMode ? (
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={selectAllVisible}
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={exitSelectionMode}
                >
                  Done
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={chats.chats.length === 0}
                onClick={() => setSelectionMode(true)}
              >
                Select
              </Button>
            )}
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <div className="group/chat-row relative flex w-full items-center gap-1">
                    {selectionMode ? (
                      <Checkbox
                        className="ml-2 shrink-0"
                        checked={selectedIds.has(chat.id)}
                        onCheckedChange={(checked) =>
                          toggleSelected(chat.id, checked === true)
                        }
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${chat.title}`}
                      />
                    ) : null}
                    <ChatRowMenus
                      chat={chat}
                      onRename={openRename}
                      onDelete={(id) => void deleteChats([id])}
                    >
                      <SidebarMenuButton
                        isActive={chats.activeChatId === chat.id}
                        onClick={() => {
                          if (selectionMode) {
                            toggleSelected(
                              chat.id,
                              !selectedIds.has(chat.id),
                            );
                            return;
                          }
                          onSelectChat(chat.id);
                        }}
                        className={cn(
                          "h-auto min-w-0 flex-1 py-2",
                          selectionMode ? "pl-1" : "pr-9",
                        )}
                      >
                        <span className="truncate text-left text-sm">
                          {chat.title}
                        </span>
                      </SidebarMenuButton>
                    </ChatRowMenus>
                    {!selectionMode ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-50 hover:opacity-100 group-hover/chat-row:opacity-100"
                            aria-label={`Actions for ${chat.title}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => openRename(chat)}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void deleteChats([chat.id])}
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
          {selectionMode && selectedIds.size > 0 ? (
            <div className="mt-2 px-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full gap-2"
                onClick={deleteSelected}
              >
                <Trash2 className="size-3.5" />
                Delete {selectedIds.size} chat
                {selectedIds.size === 1 ? "" : "s"}
              </Button>
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-1 p-3">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={onOpenKnowledge}
        >
          <BookOpen className="size-4" />
          Knowledge
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={onOpenSettings}
        >
          <Settings2 className="size-4" />
          Settings
        </Button>
      </SidebarFooter>

      <Dialog open={renameId !== null} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameId) {
                void chats.renameChat(renameId, renameTitle).then(() =>
                  setRenameId(null),
                );
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (renameId) {
                  void chats.renameChat(renameId, renameTitle).then(() =>
                    setRenameId(null),
                  );
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
