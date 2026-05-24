import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  appendMessage,
  createChat,
  deleteChat,
  getChatMessages,
  getChatHistoryForBackend,
  getChatTitle,
  listChats,
  saveFullTranscript,
  searchChats,
  serializeUserTurn,
  updateChatTitle,
  type ChatMessage,
  type ChatRow,
  type UserTurnPayload,
} from "@/lib/chatsDb";
import { generateChatTitle } from "@/lib/generateChatTitle";
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

  const persistTurn = useCallback(
    async (user: UserTurnPayload, assistantText: string) => {
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
      await refreshChats();
      const msgs = await getChatMessages(chatId);
      setMessages(msgs);
      void maybeAutoTitleChat(chatId);
    },
    [ensureActiveChat, maybeAutoTitleChat, refreshChats],
  );

  const getHistoryForBackend = useCallback(async (): Promise<
    { role: string; content: string }[]
  > => {
    if (!isTauri() || !activeChatIdRef.current) return [];
    return getChatHistoryForBackend(activeChatIdRef.current);
  }, []);

  const removeChat = useCallback(
    async (chatId: string) => {
      if (!isTauri()) return;
      await deleteChat(chatId);
      if (activeChatIdRef.current === chatId) {
        setActiveChatId(null);
        activeChatIdRef.current = null;
        setMessages([]);
      }
      await refreshChats();
    },
    [refreshChats],
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
    removeChat,
    renameChat,
    search,
  };
}
