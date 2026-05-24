import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/errorMessages";
import { invoke, isTauri, listen } from "@/lib/tauri";
import {
  connectVoiceBridge,
  disconnectVoiceBridge,
  sendVoiceBridge,
} from "@/lib/voiceBridge";
import {
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "@/lib/settings";
import { settingsToVoiceConfig, voiceWsUrl } from "@/lib/voiceConfig";

export type VoiceUiState =
  | "disconnected"
  | "connecting"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type PreflightCheck = {
  id: string;
  ok: boolean;
  message: string;
  required: boolean;
};

export type PreflightResult = {
  checks: PreflightCheck[];
  hard_ok: boolean;
};

type ServerMsg = {
  type: string;
  state?: string;
  text?: string;
  message?: string;
  code?: string;
  port?: number;
  protocol_version?: number;
};

export { DEFAULT_VOICE_SYSTEM_PROMPT };

export function useVoiceSession() {
  const [uiState, setUiState] = useState<VoiceUiState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [wsPort, setWsPort] = useState(8765);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  /** True after WebSocket connects until user stops or connection drops. */
  const [sessionActive, setSessionActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const bridgeUnlistenRef = useRef<(() => void) | null>(null);
  const intentionalCloseRef = useRef(false);
  const startAttemptRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lmBaseUrl, setLmBaseUrl] = useState(DEFAULT_VOICE_SETTINGS.lmBaseUrl);
  const [model, setModel] = useState(DEFAULT_VOICE_SETTINGS.model);
  const [pushToTalk, setPushToTalk] = useState(DEFAULT_VOICE_SETTINGS.pushToTalk);
  const [inputGain, setInputGain] = useState(DEFAULT_VOICE_SETTINGS.inputGain);
  const [vadSensitivity, setVadSensitivity] = useState(
    DEFAULT_VOICE_SETTINGS.vadSensitivity,
  );
  const [systemPrompt, setSystemPrompt] = useState(
    DEFAULT_VOICE_SETTINGS.systemPrompt,
  );
  const [piperModel, setPiperModel] = useState(DEFAULT_VOICE_SETTINGS.piperModel);
  const [whisperModel, setWhisperModel] = useState(
    DEFAULT_VOICE_SETTINGS.whisperModel,
  );
  const [vadBargeIn, setVadBargeIn] = useState(DEFAULT_VOICE_SETTINGS.vadBargeIn);
  const [supertonicVoice, setSupertonicVoice] = useState(
    DEFAULT_VOICE_SETTINGS.supertonicVoice,
  );
  const [supertonicLang, setSupertonicLang] = useState(
    DEFAULT_VOICE_SETTINGS.supertonicLang,
  );
  const [supertonicModel, setSupertonicModel] = useState(
    DEFAULT_VOICE_SETTINGS.supertonicModel,
  );

  const currentSettings = useCallback(
    (): VoiceSettings => ({
      lmBaseUrl,
      model,
      pushToTalk,
      inputGain,
      vadSensitivity,
      systemPrompt,
      piperModel,
      whisperModel,
      vadBargeIn,
      supertonicVoice,
      supertonicLang,
      supertonicModel,
    }),
    [
      lmBaseUrl,
      model,
      pushToTalk,
      inputGain,
      vadSensitivity,
      systemPrompt,
      piperModel,
      whisperModel,
      vadBargeIn,
      supertonicVoice,
      supertonicLang,
      supertonicModel,
    ],
  );

  useEffect(() => {
    void loadVoiceSettings().then((s) => {
      setLmBaseUrl(s.lmBaseUrl);
      setModel(s.model);
      setPushToTalk(s.pushToTalk);
      setInputGain(s.inputGain);
      setVadSensitivity(s.vadSensitivity);
      setSystemPrompt(s.systemPrompt);
      setPiperModel(s.piperModel);
      setWhisperModel(s.whisperModel);
      setVadBargeIn(s.vadBargeIn);
      setSupertonicVoice(s.supertonicVoice);
      setSupertonicLang(s.supertonicLang);
      setSupertonicModel(s.supertonicModel);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveVoiceSettings(currentSettings());
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settingsLoaded, currentSettings]);

  const runPreflight = useCallback(async () => {
    setPreflightBusy(true);
    try {
      if (!isTauri()) {
        const browserOnly: PreflightResult = {
          checks: [
            {
              id: "desktop",
              ok: false,
              message: "Use the desktop app: pnpm tauri dev",
              required: true,
            },
          ],
          hard_ok: false,
        };
        setPreflight(browserOnly);
        return browserOnly;
      }
      const result = await invoke<PreflightResult>("run_preflight", {
        lmBaseUrl,
      });
      setPreflight(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      return null;
    } finally {
      setPreflightBusy(false);
    }
  }, [lmBaseUrl]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void runPreflight();
  }, [settingsLoaded, runPreflight]);

  const sendJson = useCallback((obj: object) => {
    const payload = JSON.stringify(obj);
    if (isTauri()) {
      void sendVoiceBridge(payload).catch(() => {
        /* bridge may already be disconnected */
      });
      return;
    }
    const w = wsRef.current;
    if (w && w.readyState === WebSocket.OPEN) {
      w.send(payload);
    }
  }, []);

  const pushServerState = useCallback((s: string | undefined) => {
    if (!s) return;
    if (s === "idle") setUiState("idle");
    else if (s === "listening") setUiState("listening");
    else if (s === "thinking") setUiState("thinking");
    else if (s === "speaking") setUiState("speaking");
  }, []);

  const handleMessage = useCallback(
    (raw: string) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(raw) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          if (typeof msg.port === "number") setWsPort(msg.port);
          break;
        case "state":
          pushServerState(msg.state);
          break;
        case "stt_final":
          if (msg.text) {
            setTranscript((t) => [
              ...t,
              { id: crypto.randomUUID(), role: "user", text: msg.text! },
            ]);
            setStreamingAssistant("");
          }
          break;
        case "llm_token":
          if (msg.text) {
            setStreamingAssistant((prev) => prev + msg.text);
          }
          break;
        case "assistant_text":
          if (msg.text) {
            setTranscript((t) => [
              ...t,
              { id: crypto.randomUUID(), role: "assistant", text: msg.text! },
            ]);
            setStreamingAssistant("");
          }
          break;
        case "error": {
          const friendly = friendlyErrorMessage(msg.message, msg.code);
          setError(friendly);
          setUiState("error");
          toast.error(friendly);
          break;
        }
        case "notice":
          if (msg.message) toast.info(msg.message);
          break;
        case "interrupt_ack":
          break;
        default:
          break;
      }
    },
    [pushServerState],
  );

  const connectSocket = useCallback(
    async (port: number) => {
      if (isTauri()) {
        bridgeUnlistenRef.current?.();
        const unlisten = await connectVoiceBridge(port, handleMessage);
        bridgeUnlistenRef.current = unlisten;
        return null;
      }

      return new Promise<WebSocket>((resolve, reject) => {
        const url = voiceWsUrl(port);
        const ws = new WebSocket(url);
        let settled = false;

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        };

        const succeed = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(ws);
        };

        const timer = setTimeout(() => {
          fail(new Error(`Voice backend did not respond on ${url}`));
        }, 20_000);

        ws.onerror = () => {
          fail(new Error(`WebSocket failed: ${url}`));
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") return;
          handleMessage(ev.data);
          try {
            const msg = JSON.parse(ev.data) as ServerMsg;
            if (msg.type === "ready") succeed();
          } catch {
            /* ignore */
          }
        };

        ws.onopen = () => {
          // Backend sends `ready` immediately; fallback if message was missed.
          setTimeout(() => {
            if (!settled && ws.readyState === WebSocket.OPEN) succeed();
          }, 500);
        };

        ws.onclose = () => {
          if (!settled) {
            fail(new Error("Voice backend closed the connection before ready."));
            return;
          }
          wsRef.current = null;
          setSessionActive(false);
          if (intentionalCloseRef.current) {
            intentionalCloseRef.current = false;
            setUiState("disconnected");
          } else {
            setError("Connection to voice backend lost.");
            setUiState("error");
            toast.error("Connection to voice backend lost.");
          }
        };
      });
    },
    [handleMessage],
  );

  const startSession = useCallback(async () => {
    setError(null);
    const pf =
      preflight?.hard_ok === true ? preflight : await runPreflight();
    if (!pf?.hard_ok) {
      const msg = "Fix required readiness checks before starting.";
      setError(msg);
      setUiState("error");
      toast.error(msg);
      return;
    }

    // Drop stale in-flight start if user double-clicks Start.
    const attempt = (startAttemptRef.current += 1);
    setUiState("connecting");
    try {
      const port = await invoke<number>("start_backend");
      if (attempt !== startAttemptRef.current) return;
      setWsPort(port);
      await connectSocket(port);
      if (attempt !== startAttemptRef.current) {
        await disconnectVoiceBridge().catch(() => {});
        bridgeUnlistenRef.current?.();
        bridgeUnlistenRef.current = null;
        return;
      }
      setSessionActive(true);
      sendJson(settingsToVoiceConfig(currentSettings()));
      sendJson({ type: "start" });
      setUiState("listening");
    } catch (e) {
      if (attempt !== startAttemptRef.current) return;
      setSessionActive(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setUiState("error");
      toast.error(msg);
      try {
        await invoke("stop_backend");
      } catch {
        /* ignore */
      }
    }
  }, [connectSocket, currentSettings, preflight, runPreflight, sendJson]);

  const stopSession = useCallback(async () => {
    startAttemptRef.current += 1;
    intentionalCloseRef.current = true;
    setSessionActive(false);
    sendJson({ type: "stop" });
    wsRef.current?.close();
    wsRef.current = null;
    bridgeUnlistenRef.current?.();
    bridgeUnlistenRef.current = null;
    await disconnectVoiceBridge().catch(() => {});
    setStreamingAssistant("");
    try {
      await invoke("stop_backend");
    } catch {
      /* ignore */
    }
    setUiState("disconnected");
  }, [sendJson]);

  const interrupt = useCallback(() => {
    sendJson({ type: "interrupt" });
    setStreamingAssistant("");
  }, [sendJson]);

  const sendUserText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      sendJson({ type: "user_text", text: t });
    },
    [sendJson],
  );

  const pttDown = useCallback(() => {
    sendJson({ type: "ptt_down" });
  }, [sendJson]);

  const pttUp = useCallback(() => {
    sendJson({ type: "ptt_up" });
  }, [sendJson]);

  const applySettings = useCallback(async () => {
    await saveVoiceSettings(currentSettings());
    sendJson(settingsToVoiceConfig(currentSettings()));
    toast.success("Settings saved & applied", {
      description: "Persisted on disk and sent to the voice backend.",
    });
  }, [sendJson, currentSettings]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenFn: (() => void) | undefined;
    void listen<{ code?: number; message: string }>("backend-exited", (ev) => {
      setSessionActive(false);
      wsRef.current?.close();
      wsRef.current = null;
      bridgeUnlistenRef.current?.();
      bridgeUnlistenRef.current = null;
      void disconnectVoiceBridge().catch(() => {});
      const friendly = friendlyErrorMessage(ev.payload.message);
      setError(friendly);
      setUiState("error");
      toast.error("Voice backend stopped", { description: friendly });
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      unlistenFn?.();
    };
  }, []);

  const canStart =
    isTauri() &&
    preflight?.hard_ok === true &&
    uiState !== "connecting" &&
    (uiState === "disconnected" || uiState === "error");

  const canType = sessionActive && uiState !== "connecting";

  return {
    isDesktop: isTauri(),
    sessionActive,
    canType,
    uiState,
    error,
    transcript,
    streamingAssistant,
    wsPort,
    preflight,
    preflightBusy,
    canStart,
    runPreflight,
    lmBaseUrl,
    setLmBaseUrl,
    model,
    setModel,
    pushToTalk,
    setPushToTalk,
    inputGain,
    setInputGain,
    vadSensitivity,
    setVadSensitivity,
    systemPrompt,
    setSystemPrompt,
    piperModel,
    setPiperModel,
    whisperModel,
    setWhisperModel,
    vadBargeIn,
    setVadBargeIn,
    supertonicVoice,
    setSupertonicVoice,
    supertonicLang,
    setSupertonicLang,
    supertonicModel,
    setSupertonicModel,
    startSession,
    stopSession,
    interrupt,
    sendUserText,
    pttDown,
    pttUp,
    applySettings,
  };
}
