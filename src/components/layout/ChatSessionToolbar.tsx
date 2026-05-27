import { ChatKnowledgePicker } from "@/components/chat/ChatKnowledgePicker";
import { ChatModelPicker } from "@/components/chat/ChatModelPicker";
import { ChatSystemPromptEditor } from "@/components/chat/ChatSystemPromptEditor";
import { ChatTtsPicker } from "@/components/chat/ChatTtsPicker";
import { SessionStatusBadge, ContextMeter } from "@/components/layout/ChatHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { useChats } from "@/hooks/useChats";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Voice = ReturnType<typeof useVoiceSession>;
type Chats = ReturnType<typeof useChats>;

type Props = {
  v: Voice;
  chats: Chats;
};

export function ChatSessionToolbar({ v, chats }: Props) {
  return (
    <TooltipProvider delayDuration={300}>
      <header className="glass-surface glass-hairline-b flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <ChatModelPicker chats={chats} v={v} />
          <SessionStatusBadge uiState={v.uiState} />
          <ContextMeter contextUsage={v.contextUsage} />
        </div>
        <div
          className="bg-muted/30 flex shrink-0 items-center gap-0.5 rounded-lg p-0.5"
          role="toolbar"
          aria-label="Chat settings"
        >
          <ChatTtsPicker chats={chats} v={v} compact />
          <ChatSystemPromptEditor chats={chats} v={v} compact />
          <ChatKnowledgePicker chats={chats} v={v} compact />
        </div>
      </header>
    </TooltipProvider>
  );
}
