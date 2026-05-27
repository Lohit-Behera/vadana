import { useCallback, useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
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
import { SupertonicLangSelect } from "@/components/tts/SupertonicLangSelect";
import { SupertonicVoiceSelect } from "@/components/tts/SupertonicVoiceSelect";
import {
  fromSelectLangValue,
  fromSelectVoiceValue,
  toSelectLangValue,
  toSelectVoiceValue,
} from "@/lib/supertonicOptions";
import type { useChats } from "@/hooks/useChats";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Chats = ReturnType<typeof useChats>;
type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  chats: Chats;
  v: Voice;
  compact?: boolean;
};

export function ChatTtsPicker({ chats, v, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState("");
  const [lang, setLang] = useState("");

  const load = useCallback(async () => {
    const tts = await chats.getChatTts();
    setVoice(toSelectVoiceValue(tts.voice));
    setLang(toSelectLangValue(tts.lang));
  }, [chats]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    void load();
  }, [chats.activeChatId, load]);

  const persist = useCallback(
    async (nextVoice: string, nextLang: string) => {
      const voice = fromSelectVoiceValue(nextVoice);
      const lang = fromSelectLangValue(nextLang);
      await chats.ensureActiveChat();
      await chats.updateChatTts({ voice, lang });
      const saved = await chats.getChatTts();
      setVoice(toSelectVoiceValue(saved.voice));
      setLang(toSelectLangValue(saved.lang));
      if (v.sessionActive) {
        await v.reloadSessionConfig();
      } else {
        toast.message("Voice & language saved for this chat", {
          description: "Start or resume a session to apply. LLM reply language follows the language you pick.",
        });
      }
    },
    [chats, v],
  );

  const hasOverride =
    fromSelectVoiceValue(voice).length > 0 || fromSelectLangValue(lang).length > 0;

  const tooltip = hasOverride
    ? "Voice & language (chat override)"
    : "Voice & language";

  const trigger = (
    <Button
      type="button"
      variant={hasOverride ? "secondary" : "ghost"}
      size={compact ? "icon-sm" : "sm"}
      className={cn(compact ? "size-8" : "gap-1.5")}
    >
      <Volume2 className="size-3.5" />
      {!compact ? (hasOverride ? "Voice (chat)" : "Voice") : null}
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
      <DropdownMenuContent className="w-80" align="end">
        <DropdownMenuLabel>Voice & language (this chat)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-3 px-2 py-1">
          <p className="text-muted-foreground text-xs">
            Overrides global Settings for this chat only. Choose{" "}
            <strong>Settings default</strong> to use the app-wide voice and language.
          </p>
          <SupertonicVoiceSelect
            label="Voice"
            value={voice}
            onValueChange={(val) => {
              setVoice(val);
              void persist(val, lang);
            }}
            allowDefault
            size="sm"
            className="space-y-1"
            triggerClassName="w-full"
          />
          <SupertonicLangSelect
            label="Language"
            value={lang}
            onValueChange={(val) => {
              setLang(val);
              void persist(voice, val);
            }}
            allowDefault
            size="sm"
            className="space-y-1"
            triggerClassName="w-full"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
