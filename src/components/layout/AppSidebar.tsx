import { useCallback, useState } from "react";
import {
  MessageSquarePlus,
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { useChats } from "@/hooks/useChats";

type Chats = ReturnType<typeof useChats>;

type Props = {
  chats: Chats;
  onOpenSettings: () => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
};

export function AppSidebar({
  chats,
  onOpenSettings,
  onSelectChat,
  onNewChat,
}: Props) {
  const [search, setSearch] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      void chats.search(q);
    },
    [chats],
  );

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
          <SidebarGroupLabel>Recents</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <SidebarMenuButton
                        isActive={chats.activeChatId === chat.id}
                        onClick={() => onSelectChat(chat.id)}
                        className="h-auto py-2"
                      >
                        <span className="truncate text-left text-sm">
                          {chat.title}
                        </span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => {
                          setRenameId(chat.id);
                          setRenameTitle(chat.title);
                        }}
                      >
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive"
                        onClick={() => void chats.removeChat(chat.id)}
                      >
                        <Trash2 className="mr-2 size-3.5" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
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
