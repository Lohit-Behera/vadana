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
  LLM_PROVIDERS,
  defaultBaseUrlForProvider,
  fromSelectModelValue,
  providerLabel,
  resolveEffectiveLlm,
  toSelectModelValue,
  type EffectiveLlmConfig,
} from "@/lib/llmProviders";
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
        model: fromSelectModelValue(modelValue),
      };
      await chats.ensureActiveChat();
      await chats.updateChatLlm(stored);
      setModelSel(toSelectModelValue(stored.model));
      const eff = publishEffective(stored);
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
    [baseUrl, chats, modelSel, providerSel, publishEffective, v],
  );

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:text-foreground text-left text-sm font-medium transition-colors"
        >
          <span className="inline-flex items-center gap-1.5">
            <Bot className="text-muted-foreground size-3.5 shrink-0" />
            {effective.model || "Model"}
            <span className="text-muted-foreground font-normal">
              ({providerLabel(effective.provider)})
            </span>
            {hasOverride ? (
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                chat
              </span>
            ) : null}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[min(24rem,calc(100vw-2rem))]"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel>Model (this chat)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-3 px-2 py-1">
          <p className="text-muted-foreground text-xs">
            Choose a provider, fetch models, then pick one from the list.
            Empty fields use Settings defaults.
          </p>

          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={providerSel}
              modal={false}
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
              className="h-8 text-xs"
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
            value={modelSel}
            models={models}
            globalModel={v.model}
            allowDefault
            loading={fetching}
            placeholder={models.length > 0 ? "Select model" : "Fetch models first"}
            size="sm"
            triggerClassName="w-full font-mono text-xs"
            onValueChange={(val) => {
              setModelSel(val);
              void persist(val);
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
