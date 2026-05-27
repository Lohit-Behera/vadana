import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LlmModelSelect } from "@/components/llm/LlmModelSelect";
import { listLlmModels } from "@/lib/llmModels";
import {
  LLM_DEFAULT_VALUE,
  LLM_MODEL_CUSTOM_VALUE,
  LLM_PROVIDERS,
  defaultBaseUrlForProvider,
  fromSelectModelValue,
  providerLabel,
  displayModelName,
  resolveEffectiveLlm,
  toSelectModelValue,
  type EffectiveLlmConfig,
} from "@/lib/llmProviders";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/lib/settings";
import type { useChats } from "@/hooks/useChats";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Chats = ReturnType<typeof useChats>;
type Voice = ReturnType<typeof useVoiceSession>;

type Props = {
  chats: Chats;
  v: Voice;
  onEffectiveLlm?: (llm: EffectiveLlmConfig) => void;
};

export function ChatModelPicker({ chats, v, onEffectiveLlm }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [providerSel, setProviderSel] = useState<string>(LLM_DEFAULT_VALUE);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelSel, setModelSel] = useState<string>(() =>
    toSelectModelValue(""),
  );
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [fetching, setFetching] = useState(false);
  const [customModelPicker, setCustomModelPicker] = useState(false);
  const [customModelText, setCustomModelText] = useState("");
  const [effective, setEffective] = useState<EffectiveLlmConfig>({
    provider: v.llmProvider,
    baseUrl: v.lmBaseUrl,
    model: v.model,
  });
  const storedRef = useRef({ provider: "", baseUrl: "", model: "" });

  const publishEffective = useCallback(
    (chat: { provider: string; baseUrl: string; model: string }) => {
      storedRef.current = chat;
      const eff = resolveEffectiveLlm(
        {
          llmProvider: v.llmProvider,
          lmBaseUrl: v.lmBaseUrl,
          model: v.model,
        },
        chat,
      );
      setEffective(eff);
      onEffectiveLlm?.(eff);
      return eff;
    },
    [v.llmProvider, v.lmBaseUrl, v.model, onEffectiveLlm],
  );

  const load = useCallback(async () => {
    const stored = await chats.getChatLlm();
    setProviderSel(
      stored.provider.trim() ? stored.provider : LLM_DEFAULT_VALUE,
    );
    setBaseUrl(stored.baseUrl);
    setModelSel(toSelectModelValue(stored.model));
    publishEffective(stored);
  }, [chats, publishEffective]);

  useEffect(() => {
    void load();
  }, [chats.activeChatId, load]);

  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (menuOpen && !menuWasOpen.current) {
      void load();
    }
    menuWasOpen.current = menuOpen;
  }, [menuOpen, load]);

  useEffect(() => {
    setEffective(
      resolveEffectiveLlm(
        {
          llmProvider: v.llmProvider,
          lmBaseUrl: v.lmBaseUrl,
          model: v.model,
        },
        storedRef.current,
      ),
    );
  }, [v.llmProvider, v.lmBaseUrl, v.model]);

  const resolvedProvider: LlmProvider =
    providerSel === LLM_DEFAULT_VALUE
      ? v.llmProvider
      : (providerSel as LlmProvider);

  const resolvedBaseUrl =
    baseUrl.trim() ||
    (providerSel === LLM_DEFAULT_VALUE
      ? v.lmBaseUrl
      : defaultBaseUrlForProvider(resolvedProvider));

  const hasOverride =
    providerSel !== LLM_DEFAULT_VALUE ||
    baseUrl.trim().length > 0 ||
    fromSelectModelValue(modelSel).length > 0;

  const fetchModels = useCallback(async () => {
    setFetching(true);
    try {
      const list = await listLlmModels({
        provider: resolvedProvider,
        baseUrl: resolvedBaseUrl,
      });
      setModels(list.map((m) => ({ id: m.id })));
      if (list.length === 0) {
        toast.message("No models returned", {
          description: "Check that the provider is running and the base URL is correct.",
        });
      } else {
        toast.success(`Loaded ${list.length} models`);
      }
    } catch (err) {
      setModels([]);
      toast.error("Could not fetch models", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFetching(false);
    }
  }, [resolvedProvider, resolvedBaseUrl]);

  const persist = useCallback(
    async (modelOverride?: string) => {
      const modelValue = modelOverride ?? modelSel;
      const stored = {
        provider: providerSel === LLM_DEFAULT_VALUE ? "" : providerSel,
        baseUrl: baseUrl.trim(),
        model:
          modelOverride === LLM_MODEL_CUSTOM_VALUE || customModelPicker
            ? customModelText.trim()
            : fromSelectModelValue(modelValue),
      };
      await chats.ensureActiveChat();
      await chats.updateChatLlm(stored);
      setModelSel(toSelectModelValue(stored.model));
      const eff = publishEffective(stored);
      // Keep global Settings in sync with the last model chosen in-chat.
      // (Global settings are persisted by `useVoiceSession`.)
      v.setLlmProvider(eff.provider);
      v.setLmBaseUrl(eff.baseUrl);
      v.setModel(eff.model);
      if (v.sessionActive) {
        await v.reloadSessionConfig();
        toast.success("Model applied to session", {
          description: `${eff.model} (${providerLabel(eff.provider)})`,
        });
      } else {
        toast.message("Model saved for this chat", {
          description: `${eff.model} (${providerLabel(eff.provider)}). Start a session to use it.`,
        });
      }
    },
    [baseUrl, chats, customModelPicker, customModelText, modelSel, providerSel, publishEffective, v],
  );

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 max-w-[min(100%,13rem)] gap-1.5 px-2 font-normal sm:max-w-[16rem]",
            hasOverride && "border-primary/40",
          )}
          title={`${effective.model} (${providerLabel(effective.provider)})`}
        >
          <Bot className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">
            {displayModelName(effective.model)}
          </span>
          <span className="bg-muted text-muted-foreground hidden shrink-0 rounded px-1 py-px text-[10px] leading-none sm:inline">
            {providerLabel(effective.provider)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[min(24rem,calc(100vw-2rem))] p-2"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel>Model (this chat)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-4 px-2 py-2">
          <p className="text-muted-foreground text-xs">
            Choose a provider, fetch models, then pick one from the list.
            Empty fields use Settings defaults.
          </p>

          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={providerSel}
              onValueChange={(val) => {
                setProviderSel(val);
                setModels([]);
                if (val !== LLM_DEFAULT_VALUE && !baseUrl.trim()) {
                  setBaseUrl(defaultBaseUrlForProvider(val as LlmProvider));
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start">
                <SelectItem value={LLM_DEFAULT_VALUE}>
                  Settings default ({providerLabel(v.llmProvider)})
                </SelectItem>
                {LLM_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chat-llm-base">Base URL</Label>
            <Input
              id="chat-llm-base"
              className="h-9 text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={resolvedBaseUrl}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={fetching}
              onClick={() => void fetchModels()}
            >
              {fetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Fetch models
            </Button>
          </div>

          <LlmModelSelect
            id="chat-model-select"
            label="Model"
            value={customModelPicker ? LLM_MODEL_CUSTOM_VALUE : modelSel}
            models={models}
            globalModel={v.model}
            allowDefault
            allowCustom
            customModelId={customModelPicker ? customModelText : fromSelectModelValue(modelSel)}
            onCustomModelIdChange={(text) => {
              setCustomModelText(text);
              setCustomModelPicker(true);
              setModelSel(LLM_MODEL_CUSTOM_VALUE);
            }}
            customPlaceholder={
              resolvedProvider === "openrouter"
                ? "e.g. anthropic/claude-sonnet-4"
                : "Paste model id"
            }
            loading={fetching}
            placeholder={models.length > 0 ? "Select model" : "Fetch models first"}
            size="sm"
            triggerClassName="w-full font-mono text-xs"
            onValueChange={(val) => {
              if (val === LLM_MODEL_CUSTOM_VALUE) {
                setCustomModelPicker(true);
                setModelSel(LLM_MODEL_CUSTOM_VALUE);
              } else {
                setCustomModelPicker(false);
                setModelSel(val);
                void persist(val);
              }
            }}
          />
          {customModelPicker && (
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!customModelText.trim()}
              onClick={() => void persist(LLM_MODEL_CUSTOM_VALUE)}
            >
              Apply custom model
            </Button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
