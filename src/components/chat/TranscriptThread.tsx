import type { TranscriptLine } from "@/hooks/useVoiceSession";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const bubbleMax = "max-w-[min(85%,28rem)]";

function messageRowClass(role: "user" | "assistant") {
  return cn("flex w-full", role === "user" ? "justify-end" : "justify-start");
}

function bubbleClass(role: "user" | "assistant") {
  return cn(
    bubbleMax,
    "rounded-2xl px-4 py-3",
    role === "user"
      ? "border border-primary/35 bg-primary/20 text-foreground shadow-sm shadow-primary/10"
      : "glass-surface text-foreground",
  );
}

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
      <div className="mx-auto max-w-3xl space-y-5 p-6 pb-10 text-sm">
        {transcript.length === 0 && !streamingAssistant && (
          <p className="text-muted-foreground py-16 text-center text-base">
            {idleMessage}
          </p>
        )}
        {transcript.map((line) => (
          <div key={line.id} className={messageRowClass(line.role)}>
            <div className={bubbleClass(line.role)}>
              <p
                className={cn(
                  "mb-1 text-[10px] font-medium uppercase tracking-wide",
                  line.role === "user" ? "text-primary" : "text-muted-foreground",
                )}
              >
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
                        className="glass-surface rounded-lg px-2.5 py-1 text-xs"
                      >
                        {a.kind === "pdf" ? "PDF" : "File"}: {a.filename}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {streamingReasoning ? (
          <div className={messageRowClass("assistant")}>
          <Accordion
            type="single"
            collapsible
            defaultValue="thinking"
            className={cn(
              bubbleMax,
              "glass-surface text-muted-foreground rounded-xl border-dashed text-xs opacity-80",
            )}
          >
            <AccordionItem value="thinking" className="border-0">
              <AccordionTrigger className="px-4 py-2 text-xs font-medium uppercase tracking-wide hover:no-underline">
                Thinking…
              </AccordionTrigger>
              <AccordionContent className="px-0 pb-0 [&>div]:h-32 [&>div]:overflow-hidden [&>div]:pb-0">
                <ScrollArea className="h-32 px-4 pb-3">
                  <p className="whitespace-pre-wrap pr-3 leading-relaxed">
                    {streamingReasoning}
                  </p>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          </div>
        ) : null}
        {streamingAssistant ? (
          <div className={messageRowClass("assistant")}>
            <div className={cn(bubbleClass("assistant"), "opacity-90")}>
              <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
                assistant…
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">
                {streamingAssistant}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
