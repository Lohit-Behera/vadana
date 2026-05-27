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
import { ChatTranscriptPanel } from "@/components/chat/ChatTranscriptPanel";
import { ChatSessionToolbar } from "@/components/layout/ChatSessionToolbar";
import type { useChats } from "@/hooks/useChats";
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
  const showVoiceUi = inSession || isConnecting;
  const hasHistory = v.transcript.length > 0;
  const showEmptyStart = !showVoiceUi && !hasHistory;

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatSessionToolbar v={v} chats={chats} />

      {showEmptyStart ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8">
          <Button
            type="button"
            size="lg"
            className="h-12 gap-2 rounded-full px-8 text-base shadow-lg shadow-primary/25"
            disabled={!v.canStart}
            onClick={() => void v.startSession()}
          >
            <Play className="size-5" />
            Start
          </Button>
          {v.uiState === "error" && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="rounded-full"
              disabled={!v.canStart}
              onClick={() => void v.startSession()}
            >
              <RefreshCw className="size-4" />
              Retry
            </Button>
          )}
        </div>
      ) : (
        <ChatTranscriptPanel
          transcript={v.transcript}
          streamingAssistant={v.streamingAssistant}
          streamingReasoning={v.streamingReasoning}
          uiState={v.uiState}
          audioLevels={v.audioLevels}
          sessionActive={showVoiceUi}
          idleMessage="Ready when you are. Start speaking or type below."
        />
      )}

      {showVoiceUi ? (
      <footer className="glass-surface glass-hairline-t shrink-0 p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isConnecting}
              onClick={() => v.stopSessionKeepBackend()}
            >
              <Square className="size-4" />
              Stop
            </Button>
            {inSession && (
              <Button
                type="button"
                variant="outline"
                onClick={() => v.interrupt()}
              >
                <OctagonX className="size-4" />
                Interrupt
              </Button>
            )}
          </div>

          {showVoiceUi && (
            <>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2.5">
                  {pendingFiles.map((p) => (
                    <div
                      key={p.id}
                      className="glass-surface flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs"
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
              <div className="glass-surface flex gap-2 rounded-full px-3.5 py-1.5">
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

        </div>
      </footer>
      ) : hasHistory ? (
        <footer className="glass-surface glass-hairline-t shrink-0 p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="lg"
              className="h-11 gap-2 rounded-full px-8 shadow-lg shadow-primary/25"
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
                size="lg"
                className="rounded-full"
                disabled={!v.canStart}
                onClick={() => void v.startSession()}
              >
                <RefreshCw className="size-4" />
                Retry
              </Button>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
