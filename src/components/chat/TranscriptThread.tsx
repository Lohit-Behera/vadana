import type { TranscriptLine } from "@/hooks/useVoiceSession";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  transcript: TranscriptLine[];
  streamingAssistant: string;
  streamingReasoning?: string;
  idleMessage?: string;
};

export function TranscriptThread({
  transcript,
  streamingAssistant,
  streamingReasoning = "",
  idleMessage = "Ready when you are.",
}: Props) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8 text-sm">
        {transcript.length === 0 && !streamingAssistant && (
          <p className="text-muted-foreground py-16 text-center text-base">
            {idleMessage}
          </p>
        )}
        {transcript.map((line) => (
          <div
            key={line.id}
            className={
              line.role === "user"
                ? "bg-muted/60 ml-8 rounded-2xl px-4 py-3"
                : "mr-8 px-1 py-1"
            }
          >
            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
              {line.role}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">{line.text}</p>
            {line.attachments && line.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {line.attachments.map((a) =>
                  a.previewUrl && a.kind === "image" ? (
                    <img
                      key={a.id}
                      src={a.previewUrl}
                      alt={a.filename}
                      className="max-h-40 rounded-lg border object-contain"
                    />
                  ) : (
                    <span
                      key={a.id}
                      className="bg-background rounded border px-2 py-1 text-xs"
                    >
                      {a.kind === "pdf" ? "PDF" : "File"}: {a.filename}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        {streamingReasoning ? (
          <div className="text-muted-foreground mr-8 rounded-lg border border-dashed px-3 py-2 text-xs opacity-70">
            <p className="mb-1 font-medium uppercase tracking-wide">Thinking…</p>
            <p className="whitespace-pre-wrap leading-relaxed">{streamingReasoning}</p>
          </div>
        ) : null}
        {streamingAssistant ? (
          <div className="mr-8 px-1 py-1 opacity-80">
            <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
              assistant…
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">
              {streamingAssistant}
            </p>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
