import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppShell } from "@/components/layout/AppShell";
import { BackendStartupScreen } from "@/components/layout/BackendStartupScreen";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MainChat } from "@/components/layout/MainChat";
import { KnowledgePage } from "@/components/knowledge/KnowledgePage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getChatMessages } from "@/lib/chatsDb";
import { listen } from "@/lib/tauri";
import { useChats } from "@/hooks/useChats";
import { useVoiceSession } from "@/hooks/useVoiceSession";

type AppView = "chat" | "settings" | "knowledge";

export default function App() {
  const chats = useChats();
  const chatBridge = useMemo(
    () => ({
      getHistoryForBackend: chats.getHistoryForBackend,
      persistTurn: chats.persistTurn,
      ensureActiveChat: chats.ensureActiveChat,
      getKnowledgeForBackend: chats.getKnowledgeForBackend,
    }),
    [
      chats.getHistoryForBackend,
      chats.persistTurn,
      chats.ensureActiveChat,
      chats.getKnowledgeForBackend,
    ],
  );
  const v = useVoiceSession(chatBridge);
  const [view, setView] = useState<AppView>("chat");
  const [closing, setClosing] = useState(false);

  // Tauri desktop fullscreen toggle:
  // - prevents the browser/webview default handling of F11
  // - toggles the native window fullscreen instead
  useEffect(() => {
    if (!v.isDesktop) return;

    let lastToggle = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F11") return;
      const now = Date.now();
      if (now - lastToggle < 250) return; // avoid key repeat toggling too fast
      lastToggle = now;

      e.preventDefault();
      e.stopPropagation();

      const win = getCurrentWindow();
      void (async () => {
        const isFs = await win.isFullscreen();
        await win.setFullscreen(!isFs);
      })();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [v.isDesktop]);

  useEffect(() => {
    if (!v.isDesktop) return;
    let unlistenFn: (() => void) | undefined;
    void listen("app-closing", () => {
      setClosing(true);
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      unlistenFn?.();
    };
  }, [v.isDesktop]);

  const failedChecks =
    v.preflight?.checks.filter((c) => !c.ok && c.required) ?? [];
  const readinessOk = v.preflight?.hard_ok === true;

  const syncTranscriptFromMessages = useCallback(
    (
      msgs: {
        id: string;
        role: "user" | "assistant";
        text: string;
        attachments?: { id: string; kind: "image" | "pdf"; mime: string; filename: string; path: string }[];
      }[],
    ) => {
      v.loadTranscript(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          attachments: m.attachments,
        })),
      );
    },
    [v],
  );

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (v.sessionActive) {
        v.stopSessionKeepBackend();
      }
      await chats.loadChat(chatId);
      const msgs = await getChatMessages(chatId);
      syncTranscriptFromMessages(msgs);
    },
    [chats, syncTranscriptFromMessages, v],
  );

  const handleChatsDeleted = useCallback(() => {
    v.loadTranscript([]);
    v.resetContextUsage();
  }, [v]);

  const handleNewChat = useCallback(async () => {
    const transcriptSnapshot = v.transcript.map((line) => ({
      role: line.role,
      text: line.text,
    }));

    if (v.sessionActive) {
      v.stopSessionKeepBackend();
    }

    try {
      await chats.startNewChat(transcriptSnapshot);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not save chat", { description: msg });
    } finally {
      v.loadTranscript([]);
      v.resetContextUsage();
      setView("chat");
    }
  }, [chats, v]);

  const handleOpenSettings = useCallback(() => {
    setView("settings");
  }, []);

  const handleOpenKnowledge = useCallback(() => {
    setView("knowledge");
  }, []);

  if (!v.isDesktop) {
    return (
      <main className="container mx-auto max-w-lg p-6">
        <Alert variant="destructive">
          <AlertTitle>Desktop app required</AlertTitle>
          <AlertDescription>
            Close this browser tab and run{" "}
            <code className="text-xs">pnpm tauri dev</code> for the Vadana desktop
            app.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (closing) {
    return (
      <BackendStartupScreen
        status="loading"
        title="Closing Vadana"
        description="Shutting down the voice backend…"
      />
    );
  }

  if (v.backendStartupLoading) {
    let title = "Starting voice backend";
    let description: string | undefined =
      "First launch can take up to a minute while dependencies load.";
    if (!v.settingsLoaded) {
      title = "Loading Vadana";
      description = undefined;
    } else if (v.preflightBusy || !v.preflight) {
      title = "Checking setup";
      description = "Verifying uv, backend folder, and network ports.";
    } else if (v.backendConnecting) {
      title = "Connecting to voice backend";
      description = "Starting the local Python sidecar and opening WebSocket.";
    }
    return (
      <BackendStartupScreen
        status="loading"
        title={title}
        description={description}
      />
    );
  }

  if (v.backendStartupFailed) {
    const failedCheck = v.preflight?.checks.find((c) => !c.ok && c.required);
    const errorMessage = failedCheck
      ? `${failedCheck.id}: ${failedCheck.message}`
      : v.error ?? "Voice backend did not connect. Check logs and try again.";
    return (
      <BackendStartupScreen
        status="failed"
        title="Could not start voice backend"
        description="Fix the issue below, then retry."
        error={errorMessage}
        busy={v.backendConnecting}
        onRetry={() => void v.retryBackendStartup()}
      />
    );
  }

  return (
    <AppShell
      sidebar={
        <AppSidebar
          chats={chats}
          onOpenSettings={handleOpenSettings}
          onOpenKnowledge={handleOpenKnowledge}
          onSelectChat={(id) => void handleSelectChat(id)}
          onNewChat={() => void handleNewChat()}
          onChatsDeleted={handleChatsDeleted}
        />
      }
    >
      {view === "settings" ? (
        <SettingsPage v={v} onBack={() => setView("chat")} />
      ) : view === "knowledge" ? (
        <KnowledgePage v={v} onBack={() => setView("chat")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!readinessOk && v.preflight && (
            <Alert className="mx-4 mt-3 shrink-0">
              <AlertTitle className="text-sm">Readiness</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1 text-sm">
                  {failedChecks.length > 0
                    ? failedChecks.map((c) => (
                        <li key={c.id} className="flex gap-2">
                          <XCircle className="text-destructive mt-0.5 size-3.5 shrink-0" />
                          <span>
                            <strong>{c.id}</strong>: {c.message}
                          </span>
                        </li>
                      ))
                    : v.preflight.checks.map((c) => (
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
                      ))}
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
          <MainChat v={v} chats={chats} />
        </div>
      )}
    </AppShell>
  );
}
