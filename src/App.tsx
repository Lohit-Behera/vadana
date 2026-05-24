import { useState } from "react";
import {
  CheckCircle2,
  Mic,
  OctagonX,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Square,
  XCircle,
} from "lucide-react";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

export default function App() {
  const v = useVoiceSession();
  const [typedMessage, setTypedMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const inSession = v.sessionActive;
  const isConnecting = v.uiState === "connecting";
  const showComposer = inSession || isConnecting;

  const failedChecks =
    v.preflight?.checks.filter((c) => !c.ok && c.required) ?? [];
  const readinessOk = v.preflight?.hard_ok === true;

  return (
    <main className="container mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vadana</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Voice + text via local Whisper, LM Studio, and TTS.
          </p>
        </div>
        <Badge
          variant={v.uiState === "error" ? "destructive" : "secondary"}
          className="shrink-0"
        >
          {STATE_LABEL[v.uiState] ?? v.uiState}
        </Badge>
      </header>

      {!v.isDesktop && (
        <Alert variant="destructive">
          <AlertTitle>Desktop app required</AlertTitle>
          <AlertDescription>
            You opened the Vite dev server in a browser. Close this tab and run{" "}
            <code className="text-xs">pnpm tauri dev</code> to start the real app
            (Tauri needs <code className="text-xs">invoke</code> for the Python
            backend).
          </AlertDescription>
        </Alert>
      )}

      {v.error && (
        <Alert variant="destructive">
          <AlertDescription>{v.error}</AlertDescription>
        </Alert>
      )}

      {!readinessOk && v.preflight && (
        <Alert>
          <AlertTitle className="text-sm">Readiness</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1 text-sm">
              {failedChecks.length > 0 ? (
                failedChecks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <XCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <strong>{c.id}</strong>: {c.message}
                    </span>
                  </li>
                ))
              ) : (
                v.preflight.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                    )}
                    <span>
                      {c.id}
                      {!c.required && " (optional)"}: {c.message}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={v.preflightBusy}
            onClick={() => void v.runPreflight()}
          >
            <RefreshCw
              className={`mr-1 size-3.5 ${v.preflightBusy ? "animate-spin" : ""}`}
            />
            Re-check
          </Button>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((s) => !s)}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
          {readinessOk && (
            <CardDescription className="text-xs">
              ws://127.0.0.1:{v.wsPort}
              {inSession && " · Use headphones to reduce echo"}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {showComposer && (
            <div className="bg-muted/30 flex gap-2 rounded-lg border p-2">
              <Input
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                placeholder={
                  v.canType
                    ? "Type a message…"
                    : "Connecting to voice backend…"
                }
                disabled={!v.canType}
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (!v.canType) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const t = typedMessage.trim();
                    if (!t) return;
                    v.sendUserText(t);
                    setTypedMessage("");
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                disabled={!v.canType || !typedMessage.trim()}
                onClick={() => {
                  const t = typedMessage.trim();
                  if (!t) return;
                  v.sendUserText(t);
                  setTypedMessage("");
                }}
              >
                <Send className="size-4" />
              </Button>
            </div>
          )}

          {v.uiState === "connecting" && !v.canType && (
            <Skeleton className="h-32 w-full rounded-lg" />
          )}

          {inSession && v.pushToTalk && (
            <Button
              type="button"
              className="w-full"
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

          <ScrollArea className="h-56 rounded-lg border sm:h-64">
            <div className="space-y-3 p-4 text-sm">
              {v.transcript.length === 0 && !v.streamingAssistant && (
                <p className="text-muted-foreground py-8 text-center">
                  {showComposer
                    ? "Speak or type above."
                    : "Start a session to begin."}
                </p>
              )}
              {v.transcript.map((line) => (
                <div
                  key={line.id}
                  className={
                    line.role === "user"
                      ? "bg-muted/50 rounded-lg px-3 py-2"
                      : "px-1 py-1"
                  }
                >
                  <p className="text-muted-foreground mb-0.5 text-[10px] font-medium uppercase tracking-wide">
                    {line.role}
                  </p>
                  <p className="whitespace-pre-wrap">{line.text}</p>
                </div>
              ))}
              {v.streamingAssistant ? (
                <div className="px-1 py-1 opacity-80">
                  <p className="text-muted-foreground mb-0.5 text-[10px] font-medium uppercase">
                    assistant…
                  </p>
                  <p className="whitespace-pre-wrap">{v.streamingAssistant}</p>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          {showSettings && (
            <div className="border-t pt-4">
              <div className="mb-3 flex items-center justify-between">
                <Label className="text-sm font-medium">Settings</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={inSession}
                  onClick={() => void v.applySettings()}
                >
                  Save &amp; apply
                </Button>
              </div>
              <SettingsPanel v={v} disabled={inSession} />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
