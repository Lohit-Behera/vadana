import type { ContextUsage } from "@/hooks/useVoiceSession";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

const STATE_DOT: Record<string, string> = {
  disconnected: "bg-muted-foreground/50",
  connecting: "bg-amber-400 animate-pulse",
  idle: "bg-muted-foreground",
  listening: "bg-primary animate-pulse",
  thinking: "bg-amber-400 animate-pulse",
  speaking: "bg-primary",
  error: "bg-destructive",
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function SessionStatusBadge({ uiState }: { uiState: string }) {
  const label = STATE_LABEL[uiState] ?? uiState;
  const dot = STATE_DOT[uiState] ?? "bg-muted-foreground";

  return (
    <span
      className={cn(
        "border-border/60 bg-background/40 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-none",
        uiState === "error" && "border-destructive/40 text-destructive",
      )}
      title={label}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export function ContextMeter({
  contextUsage,
}: {
  contextUsage: ContextUsage | null;
}) {
  const used = contextUsage?.totalTokens ?? 0;
  if (used <= 0) return null;

  return (
    <span
      className="text-muted-foreground hidden min-w-0 truncate text-[11px] tabular-nums md:inline"
      title="Context tokens in use"
    >
      {formatTokens(used)} ctx
    </span>
  );
}
