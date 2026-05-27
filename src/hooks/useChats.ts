import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  appendMessage,
  createChat,
  deleteChat,
  getChatMessages,
  getChatHistoryForBackend,
  getChatLlm,
  getChatSystemPrompt,
  getChatTitle,
  getChatTts,
  listChats,
  setChatLlm,
  setChatSystemPrompt,
  setChatTts,
  type ChatLlmConfig,
  type ChatTtsConfig,
  saveFullTranscript,
  searchChats,
  serializeUserTurn,
  updateChatTitle,
  type ChatMessage,
  type ChatRow,
  type UserTurnPayload,
} from "@/lib/chatsDb";
import {
  generateChatTitle,
  sanitizeGeneratedTitle,
} from "@/lib/generateChatTitle";
import {
  getChatKnowledge,
  getKnowledgeCatalogForBackend,
  getKnowledgeRevision,
  setChatKnowledge,
  type ChatKnowledgeConfig,
  type KnowledgeMode,
  type KnowledgeSelection,
} from "@/lib/knowledgeDb";
import { isTauri } from "@/lib/tauri";

export type TranscriptLine = {
  role: "user" | "assistant";
  text: string;
};

export function useChats() {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const activeChatIdRef = useRef<string | null>(null);
  const ensureChatPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const refreshChats = useCallback(async () => {
    if (!isTauri()) return;
    const rows = await listChats();
    setChats(rows);
  }, []);

  const maybeAutoTitleChat = useCallback(
    async (chatId: string) => {
      if (!isTauri()) return;
      console.log("[Vadana:chat-title] maybeAutoTitleChat", { chatId });
      try {
        const current = await getChatTitle(chatId);
        if (current !== "New chat") {
          console.log("[Vadana:chat-title] skip — title already set:", current);
          return;
        }
        const msgs = await getChatMessages(chatId);
        if (msgs.length < 2) {
          console.log("[Vadana:chat-title] skip — need user+assistant, have", msgs.length);
          return;
        }
        const title = await generateChatTitle(
          msgs.map((m) => ({ role: m.role, text: m.text })),
        );
        console.log("[Vadana:chat-title] generated title:", title);
        if (title && title !== "New chat") {
          await updateChatTitle(chatId, title);
          await refreshChats();
          console.log("[Vadana:chat-title] saved title to DB");
        } else {
          console.warn("[Vadana:chat-title] title not applied (empty or New chat)");
        }
      } catch (err) {
        console.error("[Vadana:chat-title] maybeAutoTitleChat failed", err);
      }
    },
    [refreshChats],
  );

  const loadChat = useCallback(async (chatId: string) => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const msgs = await getChatMessages(chatId);
      setActiveChatId(chatId);
      activeChatIdRef.current = chatId;
      setMessages(msgs);
    } finally {
      setLoading(false);
    }
  }, []);

  const newChat = useCallback(async () => {
    if (!isTauri()) return null;
    const id = await createChat();
    setActiveChatId(id);
    activeChatIdRef.current = id;
    setMessages([]);
    await refreshChats();
    return id;
  }, [refreshChats]);

  const ensureActiveChat = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    if (activeChatIdRef.current) return activeChatIdRef.current;
    if (ensureChatPromiseRef.current) {
      return ensureChatPromiseRef.current;
    }
    ensureChatPromiseRef.current = (async () => {
      try {
        const id = await createChat();
        setActiveChatId(id);
        activeChatIdRef.current = id;
        await refreshChats();
        return id;
      } finally {
        ensureChatPromiseRef.current = null;
      }
    })();
    return ensureChatPromiseRef.current;
  }, [refreshChats]);

  /** Save current transcript to SQLite, then clear for a fresh conversation. */
  const startNewChat = useCallback(
    async (transcript: TranscriptLine[]) => {
      if (!isTauri()) {
        throw new Error("Chat history requires the Vadana desktop app.");
      }
      if (transcript.length > 0) {
        let chatId = activeChatIdRef.current;
        if (!chatId) {
          chatId = await createChat();
        }
        await saveFullTranscript(chatId, transcript);
        await refreshChats();
        void maybeAutoTitleChat(chatId);
      }
      setActiveChatId(null);
      activeChatIdRef.current = null;
      setMessages([]);
    },
    [maybeAutoTitleChat, refreshChats],
  );

  const applyChatTitleIfNew = useCallback(
    async (chatId: string, title: string) => {
      if (!isTauri()) return;
      const trimmed = sanitizeGeneratedTitle(title);
      if (!trimmed || trimmed === "New chat") return;
      const current = await getChatTitle(chatId);
      if (current !== "New chat") return;
      await updateChatTitle(chatId, trimmed);
      await refreshChats();
    },
    [refreshChats],
  );

  const persistTurn = useCallback(
    async (
      user: UserTurnPayload,
      assistantText: string,
      chatTitle?: string,
    ) => {
      if (!isTauri()) return;
      const chatId = await ensureActiveChat();
      if (!chatId) return;
      const serialized = serializeUserTurn(user);
      await appendMessage(
        chatId,
        "user",
        serialized.content,
        serialized.content_format,
      );
      await appendMessage(chatId, "assistant", assistantText);
      if (chatTitle) {
        await applyChatTitleIfNew(chatId, chatTitle);
      }
      await refreshChats();
      const msgs = await getChatMessages(chatId);
      setMessages(msgs);
    },
    [applyChatTitleIfNew, ensureActiveChat, refreshChats],
  );

  const getHistoryForBackend = useCallback(async (): Promise<
    { role: string; content: string }[]
  > => {
    if (!isTauri() || !activeChatIdRef.current) return [];
    return getChatHistoryForBackend(activeChatIdRef.current);
  }, []);

  const getKnowledgeForBackend = useCallback(async () => {
    const catalog = await getKnowledgeCatalogForBackend();
    const revision = getKnowledgeRevision();
    const chatId =
      activeChatIdRef.current ??
      (isTauri() ? await ensureActiveChat() : null);
    const chatSystemPrompt = chatId ? await getChatSystemPrompt(chatId) : "";
    const chatTts = chatId
      ? await getChatTts(chatId)
      : { voice: "", lang: "" };
    const chatLlm = chatId
      ? await getChatLlm(chatId)
      : { provider: "", baseUrl: "", model: "" };
    if (!chatId) {
      return {
        mode: "off" as const,
        selection: { folder_ids: [], file_ids: [] },
        catalog,
        revision,
        chat_system_prompt: chatSystemPrompt,
        chat_supertonic_voice: chatTts.voice,
        chat_supertonic_lang: chatTts.lang,
        chat_llm_provider: chatLlm.provider,
        chat_llm_base_url: chatLlm.baseUrl,
        chat_model: chatLlm.model,
      };
    }
    const { mode, selection } = await getChatKnowledge(chatId);
    return {
      mode,
      selection: {
        folder_ids: selection.folderIds,
        file_ids: selection.fileIds,
      },
      catalog,
      revision,
      chat_system_prompt: chatSystemPrompt,
      chat_supertonic_voice: chatTts.voice,
      chat_supertonic_lang: chatTts.lang,
      chat_llm_provider: chatLlm.provider,
      chat_llm_base_url: chatLlm.baseUrl,
      chat_model: chatLlm.model,
    };
  }, [ensureActiveChat]);

  const updateChatTts = useCallback(
    async (tts: ChatTtsConfig) => {
      if (!isTauri()) return;
      const chatId = await ensureActiveChat();
      if (!chatId) return;
      await setChatTts(chatId, tts);
    },
    [ensureActiveChat],
  );

  const updateChatLlm = useCallback(
    async (llm: ChatLlmConfig) => {
      if (!isTauri()) return;
      const chatId = await ensureActiveChat();
      if (!chatId) return;
      await setChatLlm(chatId, llm);
    },
    [ensureActiveChat],
  );

  const updateChatSystemPrompt = useCallback(
    async (prompt: string) => {
      if (!isTauri()) return;
      const chatId = await ensureActiveChat();
      if (!chatId) return;
      await setChatSystemPrompt(chatId, prompt);
    },
    [ensureActiveChat],
  );

  const updateChatKnowledge = useCallback(
    async (mode: KnowledgeMode, selection: KnowledgeSelection) => {
      if (!isTauri()) return;
      const chatId = await ensureActiveChat();
      if (!chatId) return;
      await setChatKnowledge(chatId, mode, selection);
    },
    [ensureActiveChat],
  );

  const removeChats = useCallback(
    async (chatIds: string[]) => {
      if (!isTauri() || chatIds.length === 0) return;
      const unique = [...new Set(chatIds)];
      for (const chatId of unique) {
        await deleteChat(chatId);
      }
      if (
        activeChatIdRef.current &&
        unique.includes(activeChatIdRef.current)
      ) {
        setActiveChatId(null);
        activeChatIdRef.current = null;
        setMessages([]);
      }
      await refreshChats();
    },
    [refreshChats],
  );

  const removeChat = useCallback(
    async (chatId: string) => {
      await removeChats([chatId]);
    },
    [removeChats],
  );

  const renameChat = useCallback(
    async (chatId: string, title: string) => {
      if (!isTauri()) return;
      await updateChatTitle(chatId, title);
      await refreshChats();
    },
    [refreshChats],
  );

  const search = useCallback(async (query: string) => {
    if (!isTauri()) return;
    const rows = await searchChats(query);
    setChats(rows);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        await listChats();
        await refreshChats();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Could not open chat database", { description: msg });
      }
    })();
  }, [refreshChats]);

  return {
    chats,
    activeChatId,
    messages,
    loading,
    setMessages,
    setActiveChatId,
    refreshChats,
    loadChat,
    newChat,
    startNewChat,
    ensureActiveChat,
    persistTurn,
    getHistoryForBackend,
    getKnowledgeForBackend,
    updateChatKnowledge,
    getChatKnowledge: useCallback(async (): Promise<ChatKnowledgeConfig> => {
      const chatId = activeChatIdRef.current;
      if (!chatId) {
        return { mode: "off", selection: { folderIds: [], fileIds: [] } };
      }
      return getChatKnowledge(chatId);
    }, [activeChatId]),
    getChatSystemPrompt: useCallback(async (): Promise<string> => {
      const chatId = activeChatIdRef.current;
      if (!chatId) return "";
      return getChatSystemPrompt(chatId);
    }, [activeChatId]),
    updateChatSystemPrompt,
    getChatTts: useCallback(async (): Promise<ChatTtsConfig> => {
      if (!isTauri()) return { voice: "", lang: "" };
      const chatId = activeChatIdRef.current;
      if (!chatId) return { voice: "", lang: "" };
      return getChatTts(chatId);
    }, [activeChatId, ensureActiveChat]),
    updateChatTts,
    getChatLlm: useCallback(async (): Promise<ChatLlmConfig> => {
      if (!isTauri()) return { provider: "", baseUrl: "", model: "" };
      const chatId = activeChatIdRef.current;
      if (!chatId) return { provider: "", baseUrl: "", model: "" };
      return getChatLlm(chatId);
    }, [activeChatId, ensureActiveChat]),
    updateChatLlm,
    removeChat,
    removeChats,
    renameChat,
    search,
  };
}
