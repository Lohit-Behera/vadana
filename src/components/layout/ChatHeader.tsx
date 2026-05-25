import type { ReactNode } from "react";
import type { ContextUsage } from "@/hooks/useVoiceSession";
import { Badge } from "@/components/ui/badge";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

type Props = {
  uiState: string;
  modelLine?: ReactNode;
  contextUsage: ContextUsage | null;
};

export function ChatHeader({ uiState, modelLine, contextUsage }: Props) {
  const used = contextUsage?.totalTokens ?? 0;
  const inUseLabel =
    used > 0 ? `${formatTokens(used)} tokens` : "—";

  return (
    <header className="min-w-0 flex-1 py-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{modelLine}</div>
        <Badge variant={uiState === "error" ? "destructive" : "secondary"}>
          {STATE_LABEL[uiState] ?? uiState}
        </Badge>
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-xs tabular-nums">
        <span>Context in use</span>
        <span>{inUseLabel}</span>
      </div>
    </header>
  );
}
