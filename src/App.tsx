import { useCallback, useMemo, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MainChat } from "@/components/layout/MainChat";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getChatMessages } from "@/lib/chatsDb";
import { useChats } from "@/hooks/useChats";
import { useVoiceSession } from "@/hooks/useVoiceSession";

type AppView = "chat" | "settings";

export default function App() {
  const chats = useChats();
  const chatBridge = useMemo(
    () => ({
      getHistoryForBackend: chats.getHistoryForBackend,
      persistTurn: chats.persistTurn,
      ensureActiveChat: chats.ensureActiveChat,
    }),
    [chats.getHistoryForBackend, chats.persistTurn, chats.ensureActiveChat],
  );
  const v = useVoiceSession(chatBridge);
  const [view, setView] = useState<AppView>("chat");

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
        await v.stopSession();
      }
      await chats.loadChat(chatId);
      const msgs = await getChatMessages(chatId);
      syncTranscriptFromMessages(msgs);
    },
    [chats, syncTranscriptFromMessages, v],
  );

  const handleNewChat = useCallback(async () => {
    const transcriptSnapshot = v.transcript.map((line) => ({
      role: line.role,
      text: line.text,
    }));

    if (v.sessionActive) {
      await v.stopSession();
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

  return (
    <AppShell
      sidebar={
        <AppSidebar
          chats={chats}
          v={v}
          onOpenSettings={handleOpenSettings}
          onSelectChat={(id) => void handleSelectChat(id)}
          onNewChat={() => void handleNewChat()}
        />
      }
    >
      {view === "settings" ? (
        <SettingsPage v={v} onBack={() => setView("chat")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
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
          <MainChat v={v} />
        </div>
      )}
    </AppShell>
  );
}
