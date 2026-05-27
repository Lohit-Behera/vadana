import { lazy, Suspense } from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { TranscriptThread } from "@/components/chat/TranscriptThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { AudioLevels, TranscriptLine, VoiceUiState } from "@/hooks/useVoiceSession";
import type { SphereActivity } from "@/components/chat/SentientSphere";

const SentientSphere = lazy(() =>
  import("@/components/chat/SentientSphere").then((m) => ({
    default: m.SentientSphere,
  })),
);

type Props = {
  transcript: TranscriptLine[];
  streamingAssistant: string;
  streamingReasoning?: string;
  uiState: VoiceUiState;
  audioLevels: AudioLevels;
  sessionActive: boolean;
  idleMessage?: string;
};

function sphereActivity(uiState: VoiceUiState): SphereActivity {
  if (uiState === "speaking") return "speaking";
  if (uiState === "thinking") return "thinking";
  if (uiState === "listening") return "listening";
  return "idle";
}

function sphereAudioLevel(
  activity: SphereActivity,
  audioLevels: AudioLevels,
): number {
  if (activity === "speaking") return audioLevels.tts;
  if (activity === "listening") return audioLevels.mic;
  return 0;
}

function statusLabel(
  activity: SphereActivity,
  uiState: VoiceUiState,
): string {
  if (activity === "speaking") return "Speaking";
  if (activity === "thinking" || uiState === "thinking") return "Thinking";
  if (activity === "listening") return "Listening";
  if (uiState === "connecting") return "Connecting";
  if (uiState === "error") return "Error";
  return "Idle";
}

export function ChatTranscriptPanel({
  transcript,
  streamingAssistant,
  streamingReasoning = "",
  uiState,
  audioLevels,
  sessionActive,
  idleMessage,
}: Props) {
  if (!sessionActive) {
    if (transcript.length === 0 && !streamingAssistant) {
      return <div className="min-h-0 flex-1" aria-hidden />;
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TranscriptThread
          transcript={transcript}
          streamingAssistant={streamingAssistant}
          streamingReasoning={streamingReasoning}
          idleMessage={idleMessage}
        />
      </div>
    );
  }

  const activity = sphereActivity(uiState);
  const level = sphereAudioLevel(activity, audioLevels);

  return (
    <Tabs
      defaultValue="sphere"
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <div className="glass-surface glass-hairline-b flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="transcript" className="gap-1.5 px-3">
            <MessageSquareText className="size-3.5" />
            Transcript
          </TabsTrigger>
          <TabsTrigger value="sphere" className="gap-1.5 px-3">
            <Sparkles className="size-3.5" />
            Sphere
          </TabsTrigger>
        </TabsList>
        <span className="text-muted-foreground text-xs tabular-nums">
          {statusLabel(activity, uiState)}
        </span>
      </div>

      <TabsContent
        value="transcript"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <TranscriptThread
          transcript={transcript}
          streamingAssistant={streamingAssistant}
          streamingReasoning={streamingReasoning}
          idleMessage={idleMessage}
        />
      </TabsContent>

      <TabsContent
        value="sphere"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-8">
                <Skeleton className="size-48 rounded-full" />
              </div>
            }
          >
            <SentientSphere
              activity={activity}
              audioLevel={level}
              className="min-h-0 flex-1"
            />
          </Suspense>
        </div>
      </TabsContent>
    </Tabs>
  );
}
