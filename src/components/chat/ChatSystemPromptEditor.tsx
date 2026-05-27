import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { useChats } from "@/hooks/useChats";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Chats = ReturnType<typeof useChats>;
type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  chats: Chats;
  v: Voice;
  compact?: boolean;
};

export function ChatSystemPromptEditor({ chats, v, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const text = await chats.getChatSystemPrompt();
    setDraft(text);
    setSaved(text);
  }, [chats]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    void load();
  }, [chats.activeChatId, load]);

  const persist = useCallback(async () => {
    const next = draft.trim();
    if (next === saved.trim()) return;
    await chats.updateChatSystemPrompt(next);
    setSaved(next);
    if (v.sessionActive) {
      await v.reloadSessionConfig();
      toast.success("Chat instructions applied to this session");
    } else {
      toast.message("Chat instructions saved", {
        description: "Extends the global system prompt for this chat only.",
      });
    }
  }, [chats, draft, saved, v]);

  const hasAddon = saved.trim().length > 0;

  const tooltip = hasAddon
    ? "Chat instructions (active)"
    : "Add chat instructions";

  const trigger = (
    <Button
      type="button"
      variant={hasAddon ? "secondary" : "ghost"}
      size={compact ? "icon-sm" : "sm"}
      className={cn(compact ? "size-8" : "gap-1.5")}
    >
      <MessageSquarePlus className="size-3.5" />
      {!compact ? (hasAddon ? "Chat instructions" : "Add chat instructions") : null}
    </Button>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent className="w-96" align="end">
        <DropdownMenuLabel>Chat instructions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-2 px-2 py-1">
          <p className="text-muted-foreground text-xs">
            Added to the global system prompt for this chat only (does not replace Settings).
          </p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. You are helping me practice for a job interview. Be encouraging but concise."
            rows={6}
            className="resize-y text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft("");
                void (async () => {
                  await chats.updateChatSystemPrompt("");
                  setSaved("");
                  if (v.sessionActive) await v.reloadSessionConfig();
                })();
              }}
              disabled={!draft && !saved}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void persist()}
            >
              Save
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
