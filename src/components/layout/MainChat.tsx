import {
  Mic,
  OctagonX,
  Paperclip,
  Play,
  RefreshCw,
  Send,
  Square,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { TranscriptThread } from "@/components/chat/TranscriptThread";
import { ChatKnowledgePicker } from "@/components/chat/ChatKnowledgePicker";
import { ChatSystemPromptEditor } from "@/components/chat/ChatSystemPromptEditor";
import { ChatModelPicker } from "@/components/chat/ChatModelPicker";
import { ChatTtsPicker } from "@/components/chat/ChatTtsPicker";
import { ChatHeader } from "@/components/layout/ChatHeader";
import type { useChats } from "@/hooks/useChats";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  attachmentPreviewUrl,
  revokePreviewUrl,
  stageAttachment,
  type PendingAttachment,
} from "@/lib/attachments";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  v: Voice;
  chats: ReturnType<typeof useChats>;
};

export function MainChat({ v, chats }: Props) {
  const [typedMessage, setTypedMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [staging, setStaging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inSession = v.sessionActive;
  const isConnecting = v.uiState === "connecting";
  const showComposer = inSession || isConnecting;

  const clearPending = useCallback(() => {
    for (const p of pendingFiles) {
      revokePreviewUrl(p.previewUrl);
    }
    setPendingFiles([]);
  }, [pendingFiles]);

  const onPickFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setStaging(true);
    try {
      const stagedBatch: PendingAttachment[] = [];
      for (const file of Array.from(files)) {
        const staged = await stageAttachment(file);
        stagedBatch.push({
          ...staged,
          previewUrl: attachmentPreviewUrl(file),
        });
      }
      setPendingFiles((prev) => [...prev, ...stagedBatch]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStaging(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const item = prev.find((p) => p.id === id);
      revokePreviewUrl(item?.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const sendMessage = useCallback(() => {
    const text = typedMessage.trim();
    if (!text && pendingFiles.length === 0) return;
    v.sendUserMessage({
      text,
      attachments: pendingFiles.map((p) => ({
        id: p.id,
        kind: p.kind,
        mime: p.mime,
        filename: p.filename,
        path: p.path,
        previewUrl: p.previewUrl,
      })),
    });
    setTypedMessage("");
    clearPending();
  }, [typedMessage, pendingFiles, v, clearPending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4">
        <ChatHeader
          uiState={v.uiState}
          modelLine={<ChatModelPicker chats={chats} v={v} />}
          contextUsage={v.contextUsage}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ChatTtsPicker chats={chats} v={v} />
          <ChatSystemPromptEditor chats={chats} v={v} />
          <ChatKnowledgePicker chats={chats} v={v} />
        </div>
      </div>

      {v.error && (
        <Alert variant="destructive" className="mx-4 mt-3 shrink-0">
          <AlertDescription>{v.error}</AlertDescription>
        </Alert>
      )}

      <TranscriptThread
        transcript={v.transcript}
        streamingAssistant={v.streamingAssistant}
        streamingReasoning={v.streamingReasoning}
        idleMessage={
          showComposer
            ? "Ready when you are. Start speaking or type below."
            : "Press Start to begin a voice session."
        }
      />

      <footer className="border-t p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!inSession && !isConnecting ? (
              <>
                <Button
                  type="button"
                  disabled={!v.canStart}
                  onClick={() => void v.startSession()}
                >
                  <Play className="size-4" />
                  Start
                </Button>
                {v.uiState === "error" && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!v.canStart}
                    onClick={() => void v.startSession()}
                  >
                    <RefreshCw className="size-4" />
                    Retry
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={isConnecting}
                onClick={() => void v.stopSession()}
              >
                <Square className="size-4" />
                Stop
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={!inSession}
              onClick={() => v.interrupt()}
            >
              <OctagonX className="size-4" />
              Interrupt
            </Button>
          </div>

          {showComposer && (
            <>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((p) => (
                    <div
                      key={p.id}
                      className="bg-muted/60 flex items-center gap-2 rounded-lg border px-2 py-1 text-xs"
                    >
                      {p.previewUrl ? (
                        <img
                          src={p.previewUrl}
                          alt=""
                          className="size-10 rounded object-cover"
                        />
                      ) : (
                        <span className="text-muted-foreground px-1">PDF</span>
                      )}
                      <span className="max-w-[120px] truncate">{p.filename}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        disabled={!v.canType}
                        onClick={() => removePending(p.id)}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="bg-muted/40 flex gap-2 rounded-full border px-3 py-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="rounded-full"
                  disabled={!v.canType || staging}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
                <Input
                  value={typedMessage}
                  onChange={(e) => setTypedMessage(e.target.value)}
                  placeholder={
                    v.canType
                      ? "Type a message or attach image/PDF…"
                      : "Connecting…"
                  }
                  disabled={!v.canType}
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (!v.canType) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="rounded-full"
                  disabled={
                    !v.canType ||
                    staging ||
                    (!typedMessage.trim() && pendingFiles.length === 0)
                  }
                  onClick={sendMessage}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}

          {v.uiState === "connecting" && !v.canType && (
            <Skeleton className="h-10 w-full rounded-full" />
          )}

          {inSession && v.pushToTalk && (
            <Button
              type="button"
              className="w-full rounded-full"
              size="lg"
              onPointerDown={(e) => {
                e.preventDefault();
                v.pttDown();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                v.pttUp();
              }}
              onPointerLeave={(e) => {
                if (e.buttons === 0) v.pttUp();
              }}
            >
              <Mic className="size-4" />
              Hold to speak
            </Button>
          )}

          {!inSession && v.preflight?.hard_ok && (
            <p className="text-muted-foreground text-center text-xs">
              ws://127.0.0.1:{v.wsPort} · Use headphones to reduce echo
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
