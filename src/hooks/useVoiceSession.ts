import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  type LlmProvider,
  type VoiceSettings,
} from "@/lib/settings";
import {
  normalizeSupertonicLang,
  normalizeSupertonicVoice,
} from "@/lib/supertonicOptions";
import type { UserTurnPayload } from "@/lib/chatsDb";
import { smoothAudioLevel } from "@/lib/audioLevel";
import { settingsToVoiceConfig, voiceWsUrl } from "@/lib/voiceConfig";

export type VoiceUiState =
  | "disconnected"
  | "connecting"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type TranscriptAttachment = {
  id: string;
  kind: "image" | "pdf";
  mime: string;
  filename: string;
  path: string;
  previewUrl?: string;
};

export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: TranscriptAttachment[];
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
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  max_context_tokens?: number;
  percent?: number;
  user_display?: string;
  chat_title?: string;
  source?: string;
  level?: number;
};

export type AudioLevels = {
  mic: number;
  tts: number;
};

export type ContextUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  percent: number;
};

export type UserMessagePayload = {
  text: string;
  attachments?: TranscriptAttachment[];
};

export type KnowledgeBackendPayload = {
  mode: "off" | "all_enabled" | "selected";
  selection: { folder_ids: string[]; file_ids: string[] };
  catalog: {
    id: string;
    folder_id: string;
    rel_path: string;
    filename: string;
    enabled: boolean;
    folder_enabled: boolean;
    char_count: number;
  }[];
  revision: number;
  /** Per-chat addon; appended to global system_prompt on the backend. */
  chat_system_prompt: string;
  /** Per-chat TTS; empty = use global Settings. */
  chat_supertonic_voice: string;
  chat_supertonic_lang: string;
  /** Per-chat LLM; empty = use global Settings. */
  chat_llm_provider: string;
  chat_llm_base_url: string;
  chat_model: string;
};

export type ChatBridge = {
  getHistoryForBackend: () => Promise<{ role: string; content: string }[]>;
  persistTurn: (
    user: UserTurnPayload,
    assistantText: string,
    chatTitle?: string,
  ) => Promise<void>;
  ensureActiveChat: () => Promise<string | null>;
  getKnowledgeForBackend?: () => Promise<KnowledgeBackendPayload>;
};

export { DEFAULT_VOICE_SYSTEM_PROMPT };

export function useVoiceSession(chatBridge?: ChatBridge) {
  const [uiState, setUiState] = useState<VoiceUiState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [wsPort, setWsPort] = useState(8765);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendConnecting, setBackendConnecting] = useState(false);
  const [backendLogPath, setBackendLogPath] = useState("");
  /** Auto-connect finished (success or gave up); drives startup splash / retry UI. */
  const [backendStartupSettled, setBackendStartupSettled] = useState(false);
  /** User passed the first-time startup gate (do not show full-page loader again). */
  const [initialStartupComplete, setInitialStartupComplete] = useState(false);
  /** True after WebSocket connects until user stops or connection drops. */
  const [sessionActive, setSessionActive] = useState(false);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({ mic: 0, tts: 0 });
  const smoothMicRef = useRef(0);
  const smoothTtsRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingUserTextRef = useRef<UserMessagePayload | null>(null);
  /** Typed multimodal sends add the user line locally before `stt_final`. */
  const skipNextSttFinalAppendRef = useRef(false);
  const chatBridgeRef = useRef(chatBridge);
  chatBridgeRef.current = chatBridge;
  const bridgeUnlistenRef = useRef<(() => void) | null>(null);
  const intentionalCloseRef = useRef(false);
  const appShuttingDownRef = useRef(false);
  const autoConnectRanRef = useRef(false);
  const initialStartupCompleteRef = useRef(false);
  const connectInFlightRef = useRef<Promise<boolean> | null>(null);
  const startAttemptRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(
    DEFAULT_VOICE_SETTINGS.llmProvider,
  );
  const [lmBaseUrl, setLmBaseUrl] = useState(DEFAULT_VOICE_SETTINGS.lmBaseUrl);
  const [model, setModel] = useState(DEFAULT_VOICE_SETTINGS.model);
  const [maxContextTokens, setMaxContextTokens] = useState(
    DEFAULT_VOICE_SETTINGS.maxContextTokens,
  );
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
  const [modelsRoot, setModelsRoot] = useState(
    DEFAULT_VOICE_SETTINGS.modelsRoot,
  );
  const [vectorStoreIds, setVectorStoreIds] = useState<string[]>(
    DEFAULT_VOICE_SETTINGS.vectorStoreIds,
  );

  const currentSettings = useCallback(
    (): VoiceSettings => ({
      llmProvider,
      lmBaseUrl,
      model,
      maxContextTokens,
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
      modelsRoot,
      vectorStoreIds,
    }),
    [
      llmProvider,
      lmBaseUrl,
      model,
      maxContextTokens,
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
      modelsRoot,
      vectorStoreIds,
    ],
  );

  useEffect(() => {
    void loadVoiceSettings().then((s) => {
      setLlmProvider(s.llmProvider ?? DEFAULT_VOICE_SETTINGS.llmProvider);
      setLmBaseUrl(s.lmBaseUrl);
      setModel(s.model);
      setMaxContextTokens(s.maxContextTokens ?? DEFAULT_VOICE_SETTINGS.maxContextTokens);
      setPushToTalk(s.pushToTalk);
      setInputGain(s.inputGain);
      setVadSensitivity(s.vadSensitivity);
      setSystemPrompt(s.systemPrompt);
      setPiperModel(s.piperModel);
      setWhisperModel(s.whisperModel);
      setVadBargeIn(s.vadBargeIn);
      setSupertonicVoice(normalizeSupertonicVoice(s.supertonicVoice));
      setSupertonicLang(normalizeSupertonicLang(s.supertonicLang));
      setSupertonicModel(s.supertonicModel);
      setModelsRoot(s.modelsRoot ?? DEFAULT_VOICE_SETTINGS.modelsRoot);
      setVectorStoreIds(s.vectorStoreIds ?? DEFAULT_VOICE_SETTINGS.vectorStoreIds);
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
      setError(msg);
      setUiState("error");
      return null;
    } finally {
      setPreflightBusy(false);
    }
  }, [lmBaseUrl]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void runPreflight();
  }, [settingsLoaded, runPreflight]);

  useEffect(() => {
    if (!settingsLoaded || !isTauri()) return;
    void invoke<string>("voice_backend_log_path")
      .then((path) => setBackendLogPath(path))
      .catch(() => {
        /* best-effort */
      });
  }, [settingsLoaded]);

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

  const buildVoiceConfig = useCallback(async () => {
    const s = currentSettings();
    let apiKey = "";
    if (isTauri() && s.llmProvider !== "lm_studio" && s.llmProvider !== "ollama") {
      try {
        apiKey = await invoke<string>("get_provider_api_key", {
          provider: s.llmProvider,
        });
      } catch {
        apiKey = "";
      }
    }
    if (chatBridgeRef.current?.ensureActiveChat) {
      await chatBridgeRef.current.ensureActiveChat();
    }
    const chatHistory = chatBridgeRef.current
      ? await chatBridgeRef.current.getHistoryForBackend()
      : [];
    let attachmentsDir = "";
    let knowledgeDir = "";
    let knowledgeIndexDir = "";
    if (isTauri()) {
      try {
        attachmentsDir = await invoke<string>("get_attachments_dir");
      } catch {
        attachmentsDir = "";
      }
      try {
        const dirs = await invoke<{
          knowledgeDir: string;
          knowledgeIndexDir: string;
        }>("get_knowledge_dirs");
        knowledgeDir = dirs.knowledgeDir ?? "";
        knowledgeIndexDir = dirs.knowledgeIndexDir ?? "";
      } catch {
        knowledgeDir = "";
        knowledgeIndexDir = "";
      }
    }
    const knowledge = chatBridgeRef.current?.getKnowledgeForBackend
      ? await chatBridgeRef.current.getKnowledgeForBackend()
      : undefined;
    return settingsToVoiceConfig(s, {
      apiKey,
      chatHistory,
      attachmentsDir,
      knowledgeDir,
      knowledgeIndexDir,
      knowledge: knowledge
        ? {
            mode: knowledge.mode,
            selection: knowledge.selection,
            catalog: knowledge.catalog,
            revision: knowledge.revision,
            chat_system_prompt: knowledge.chat_system_prompt,
            chat_supertonic_voice: knowledge.chat_supertonic_voice,
            chat_supertonic_lang: knowledge.chat_supertonic_lang,
            chat_llm_provider: knowledge.chat_llm_provider,
            chat_llm_base_url: knowledge.chat_llm_base_url,
            chat_model: knowledge.chat_model,
          }
        : undefined,
    });
  }, [currentSettings]);

  const sendConfig = useCallback(async () => {
    const cfg = await buildVoiceConfig();
    const payload = JSON.stringify(cfg);
    if (isTauri()) {
      await sendVoiceBridge(payload);
      return;
    }
    const w = wsRef.current;
    if (w && w.readyState === WebSocket.OPEN) {
      w.send(payload);
    }
  }, [buildVoiceConfig]);

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
        case "state": {
          const s = msg.state;
          pushServerState(s);
          if (s === "listening") {
            smoothTtsRef.current = 0;
            setAudioLevels((prev) => ({ ...prev, tts: 0 }));
          } else if (s === "speaking") {
            smoothMicRef.current = 0;
            setAudioLevels((prev) => ({ ...prev, mic: 0 }));
          } else if (s === "thinking" || s === "idle") {
            smoothMicRef.current = 0;
            smoothTtsRef.current = 0;
            setAudioLevels({ mic: 0, tts: 0 });
          }
          break;
        }
        case "audio_level": {
          const src = msg.source;
          const level =
            typeof msg.level === "number"
              ? Math.max(0, Math.min(1, msg.level))
              : 0;
          if (src === "mic") {
            smoothMicRef.current = smoothAudioLevel(
              smoothMicRef.current,
              level,
            );
            setAudioLevels((prev) => ({
              ...prev,
              mic: smoothMicRef.current,
            }));
          } else if (src === "tts") {
            smoothTtsRef.current = smoothAudioLevel(
              smoothTtsRef.current,
              level,
            );
            setAudioLevels((prev) => ({
              ...prev,
              tts: smoothTtsRef.current,
            }));
          }
          break;
        }
        case "stt_final":
          if (msg.text) {
            const pending = pendingUserTextRef.current;
            pendingUserTextRef.current = {
              text: msg.text,
              attachments: pending?.attachments ?? [],
            };
            if (!skipNextSttFinalAppendRef.current) {
              setTranscript((t) => [
                ...t,
                { id: crypto.randomUUID(), role: "user", text: msg.text! },
              ]);
            }
            skipNextSttFinalAppendRef.current = false;
            setStreamingAssistant("");
            setStreamingReasoning("");
          }
          break;
        case "llm_reasoning_token":
          if (msg.text) {
            setStreamingReasoning((prev) => prev + msg.text);
          }
          break;
        case "llm_token":
          if (msg.text) {
            setStreamingAssistant((prev) => prev + msg.text);
          }
          break;
        case "assistant_text":
          if (msg.text) {
            const userPayload = pendingUserTextRef.current;
            pendingUserTextRef.current = null;
            if (userPayload && chatBridgeRef.current) {
              void chatBridgeRef.current.persistTurn(
                {
                  text: userPayload.text,
                  attachments: userPayload.attachments?.map((a) => ({
                    id: a.id,
                    kind: a.kind,
                    mime: a.mime,
                    filename: a.filename,
                    path: a.path,
                  })),
                },
                msg.text,
                msg.chat_title,
              );
            }
            setTranscript((t) => [
              ...t,
              { id: crypto.randomUUID(), role: "assistant", text: msg.text! },
            ]);
            setStreamingAssistant("");
            setStreamingReasoning("");
          }
          break;
        case "context_usage":
          setContextUsage({
            promptTokens: msg.prompt_tokens ?? 0,
            completionTokens: msg.completion_tokens ?? 0,
            totalTokens: msg.total_tokens ?? 0,
            maxContextTokens: msg.max_context_tokens ?? maxContextTokens,
            percent: msg.percent ?? 0,
          });
          break;
        case "error": {
          const friendly = friendlyErrorMessage(msg.message, msg.code);
          setError(friendly);
          setUiState("error");
          setSessionActive(false);
          if (msg.code === "bridge_failed") {
            bridgeUnlistenRef.current?.();
            bridgeUnlistenRef.current = null;
            setBackendConnected(false);
            void disconnectVoiceBridge().catch(() => {});
          }
          toast.error(friendly);
          break;
        }
        case "notice":
          if (msg.message) toast.info(msg.message);
          break;
        case "interrupt_ack":
          smoothMicRef.current = 0;
          smoothTtsRef.current = 0;
          setAudioLevels({ mic: 0, tts: 0 });
          break;
        default:
          break;
      }
    },
    [pushServerState, maxContextTokens],
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
            setBackendConnected(false);
            setSessionActive(false);
            toast.error("Connection to voice backend lost.");
          }
        };
      });
    },
    [handleMessage],
  );

  const connectBackend = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!isTauri()) return false;
      if (appShuttingDownRef.current) return false;
      if (connectInFlightRef.current) {
        return connectInFlightRef.current;
      }

      const task = (async () => {
        setError(null);
        const pf =
          preflight?.hard_ok === true ? preflight : await runPreflight();
        if (!pf?.hard_ok) {
          if (!silent) {
            const msg =
              "Fix required readiness checks before connecting backend.";
            setError(msg);
            setUiState("error");
            toast.error(msg);
          }
          return false;
        }

        setBackendConnecting(true);
        setBackendConnected(false);
        if (!sessionActive) {
          setUiState("connecting");
        }
        try {
          const port = await invoke<number>("start_backend");
          setWsPort(port);
          await connectSocket(port);
          await sendConfig();
          setBackendConnected(true);
          setInitialStartupComplete(true);
          initialStartupCompleteRef.current = true;
          if (!sessionActive) {
            setUiState("idle");
          }
          return true;
        } catch (e) {
          setBackendConnected(false);
          setSessionActive(false);
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setUiState("error");
          if (!silent) toast.error(msg);
          try {
            await invoke("stop_backend");
          } catch {
            /* ignore */
          }
          return false;
        } finally {
          setBackendConnecting(false);
        }
      })();

      connectInFlightRef.current = task;
      try {
        return await task;
      } finally {
        if (connectInFlightRef.current === task) {
          connectInFlightRef.current = null;
        }
      }
    },
    [preflight, runPreflight, connectSocket, sendConfig, sessionActive],
  );

  const startSession = useCallback(async () => {
    setError(null);
    if (!backendConnected) {
      const connected = await connectBackend();
      if (!connected) return;
    }
    if (backendConnecting) {
      const msg = "Backend is still connecting. Please wait.";
      setError(msg);
      toast.message(msg);
      return;
    }

    // Drop stale in-flight start if user double-clicks Start.
    const attempt = (startAttemptRef.current += 1);
    setUiState("idle");
    try {
      setSessionActive(true);
      if (chatBridgeRef.current?.ensureActiveChat) {
        await chatBridgeRef.current.ensureActiveChat();
      }
      sendJson({ type: "start" });
      setUiState("listening");
    } catch (e) {
      if (attempt !== startAttemptRef.current) return;
      setSessionActive(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setUiState("error");
      toast.error(msg);
    }
  }, [backendConnected, backendConnecting, connectBackend, sendJson]);

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
    setBackendConnected(false);
    setBackendConnecting(false);
    setStreamingAssistant("");
    setStreamingReasoning("");
    smoothMicRef.current = 0;
    smoothTtsRef.current = 0;
    setAudioLevels({ mic: 0, tts: 0 });
    try {
      await invoke("stop_backend");
    } catch {
      /* ignore */
    }
    setUiState("disconnected");
  }, [sendJson]);

  const stopSessionKeepBackend = useCallback(() => {
    startAttemptRef.current += 1;
    intentionalCloseRef.current = false;
    setSessionActive(false);
    sendJson({ type: "stop" });
    setStreamingAssistant("");
    setStreamingReasoning("");
    smoothMicRef.current = 0;
    smoothTtsRef.current = 0;
    setAudioLevels({ mic: 0, tts: 0 });
    setError(null);
    // Keep backend + bridge alive so next chat can start immediately.
    setUiState(backendConnected ? "idle" : "disconnected");
  }, [sendJson, backendConnected]);

  const interrupt = useCallback(() => {
    sendJson({ type: "interrupt" });
    setStreamingAssistant("");
    setStreamingReasoning("");
    smoothMicRef.current = 0;
    smoothTtsRef.current = 0;
    setAudioLevels({ mic: 0, tts: 0 });
  }, [sendJson]);

  const sendUserText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      sendJson({ type: "user_text", text: t });
    },
    [sendJson],
  );

  const sendUserMessage = useCallback(
    (payload: UserMessagePayload) => {
      const text = payload.text.trim();
      const attachments = payload.attachments ?? [];
      if (!text && attachments.length === 0) return;

      const displayAttachments = attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        mime: a.mime,
        filename: a.filename,
        path: a.path,
        previewUrl: a.previewUrl,
      }));

      skipNextSttFinalAppendRef.current = true;
      pendingUserTextRef.current = {
        text: text || attachments.map((a) => a.filename).join(", "),
        attachments: displayAttachments,
      };

      setTranscript((t) => [
        ...t,
        {
          id: crypto.randomUUID(),
          role: "user",
          text:
            text ||
            attachments.map((a) => `[${a.kind}: ${a.filename}]`).join(" "),
          attachments: displayAttachments,
        },
      ]);
      setStreamingAssistant("");
      setStreamingReasoning("");

      sendJson({
        type: "user_message",
        text,
        attachments: attachments.map((a) => ({
          id: a.id,
          kind: a.kind,
          mime: a.mime,
          path: a.path,
          filename: a.filename,
        })),
      });
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
    await sendConfig();
    toast.success("Settings saved & applied", {
      description: "Persisted on disk and sent to the voice backend.",
    });
  }, [currentSettings, sendConfig]);

  const reloadSessionConfig = useCallback(async () => {
    if (!sessionActive) return;
    const cfg = await buildVoiceConfig();
    const payload = JSON.stringify(cfg);
    if (isTauri()) {
      await sendVoiceBridge(payload);
    } else {
      const w = wsRef.current;
      if (w && w.readyState === WebSocket.OPEN) {
        w.send(payload);
      }
    }
    toast.success("Session config updated", {
      description: `LLM ${cfg.model} (${cfg.llm_provider}), TTS ${cfg.supertonic_voice || "default"} / ${cfg.supertonic_lang}`,
    });
  }, [sessionActive, buildVoiceConfig]);

  const sendKnowledgeReindex = useCallback(() => {
    sendJson({ type: "knowledge_reindex" });
  }, [sendJson]);

  const loadTranscript = useCallback((lines: TranscriptLine[]) => {
    setTranscript(lines);
    setStreamingAssistant("");
    setStreamingReasoning("");
    pendingUserTextRef.current = null;
  }, []);

  const resetContextUsage = useCallback(() => {
    setContextUsage(null);
  }, []);

  /** Bleed off stuck peaks between sparse backend level events. */
  useEffect(() => {
    if (!sessionActive) return;
    const id = window.setInterval(() => {
      let changed = false;
      if (smoothMicRef.current > 0.01) {
        smoothMicRef.current *= 0.9;
        if (smoothMicRef.current < 0.01) smoothMicRef.current = 0;
        changed = true;
      }
      if (smoothTtsRef.current > 0.01) {
        smoothTtsRef.current *= 0.9;
        if (smoothTtsRef.current < 0.01) smoothTtsRef.current = 0;
        changed = true;
      }
      if (changed) {
        setAudioLevels({
          mic: smoothMicRef.current,
          tts: smoothTtsRef.current,
        });
      }
    }, 70);
    return () => window.clearInterval(id);
  }, [sessionActive]);

  useEffect(() => {
    if (!isTauri()) return;
    let closeUnlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(() => {
        appShuttingDownRef.current = true;
        intentionalCloseRef.current = true;
        bridgeUnlistenRef.current?.();
        bridgeUnlistenRef.current = null;
        void disconnectVoiceBridge().catch(() => {});
        // Backend is stopped by Rust on WindowEvent::CloseRequested / Exit.
      })
      .then((fn) => {
        closeUnlisten = fn;
      });

    let unlistenFn: (() => void) | undefined;
    void listen<{ code?: number; message: string }>("backend-exited", (ev) => {
      if (appShuttingDownRef.current) return;
      setSessionActive(false);
      setBackendConnected(false);
      setBackendConnecting(false);
      if (!initialStartupCompleteRef.current) {
        setBackendStartupSettled(true);
      }
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
      closeUnlisten?.();
      unlistenFn?.();
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !isTauri()) return;
    if (appShuttingDownRef.current) return;
    if (autoConnectRanRef.current) return;
    if (initialStartupComplete || backendConnected) return;
    if (preflightBusy) return;
    if (preflight && !preflight.hard_ok) {
      setBackendStartupSettled(true);
      return;
    }
    if (preflight?.hard_ok !== true) return;

    autoConnectRanRef.current = true;
    let cancelled = false;
    setBackendStartupSettled(false);

    void (async () => {
      const ok = await connectBackend({ silent: true });
      if (!cancelled) {
        setBackendStartupSettled(true);
        if (ok) setInitialStartupComplete(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settingsLoaded,
    preflight?.hard_ok,
    preflightBusy,
    initialStartupComplete,
    backendConnected,
    connectBackend,
  ]);

  const retryBackendStartup = useCallback(async () => {
    setBackendStartupSettled(false);
    setError(null);
    const pf =
      preflight?.hard_ok === true ? preflight : await runPreflight();
    if (!pf?.hard_ok) {
      setBackendStartupSettled(true);
      return false;
    }
    const ok = await connectBackend({ silent: false });
    if (ok) {
      setInitialStartupComplete(true);
      initialStartupCompleteRef.current = true;
    }
    setBackendStartupSettled(true);
    return ok;
  }, [preflight, runPreflight, connectBackend]);

  const backendStartupLoading =
    isTauri() &&
    !appShuttingDownRef.current &&
    !initialStartupComplete &&
    !backendConnected &&
    (!settingsLoaded ||
      preflightBusy ||
      !preflight ||
      backendConnecting ||
      (preflight?.hard_ok === true && !backendStartupSettled));

  const backendStartupFailed =
    isTauri() &&
    !appShuttingDownRef.current &&
    !initialStartupComplete &&
    settingsLoaded &&
    !backendConnected &&
    !backendConnecting &&
    backendStartupSettled;

  const canStart =
    isTauri() &&
    uiState === "idle" &&
    preflight?.hard_ok === true &&
    backendConnected &&
    !backendConnecting &&
    !sessionActive;

  const canType = sessionActive && uiState !== "connecting";

  return {
    isDesktop: isTauri(),
    settingsLoaded,
    sessionActive,
    canType,
    uiState,
    error,
    transcript,
    streamingAssistant,
    streamingReasoning,
    contextUsage,
    audioLevels,
    wsPort,
    preflight,
    preflightBusy,
    backendConnected,
    backendConnecting,
    backendLogPath,
    initialStartupComplete,
    backendStartupLoading,
    backendStartupFailed,
    retryBackendStartup,
    canStart,
    runPreflight,
    connectBackend,
    llmProvider,
    setLlmProvider,
    lmBaseUrl,
    setLmBaseUrl,
    model,
    setModel,
    maxContextTokens,
    setMaxContextTokens,
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
    modelsRoot,
    setModelsRoot,
    startSession,
    stopSession,
    stopSessionKeepBackend,
    interrupt,
    sendUserText,
    sendUserMessage,
    pttDown,
    pttUp,
    applySettings,
    currentSettings,
    reloadSessionConfig,
    loadTranscript,
    resetContextUsage,
    sendConfig,
    sendKnowledgeReindex,
  };
}
