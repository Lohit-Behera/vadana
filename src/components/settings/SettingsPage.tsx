import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, HardDrive, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { LlmModelSelect } from "@/components/llm/LlmModelSelect";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listLlmModels } from "@/lib/llmModels";
import { defaultBaseUrlForProvider } from "@/lib/llmProviders";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteProviderApiKey,
  hasProviderApiKey,
  providerNeedsApiKey,
  setProviderApiKey,
} from "@/lib/keychain";
import { saveVoiceSettings, type LlmProvider } from "@/lib/settings";
import type { useVoiceSession } from "@/hooks/useVoiceSession";

type Voice = ReturnType<typeof useVoiceSession>;

const PROVIDERS: { id: LlmProvider; label: string }[] = [
  { id: "lm_studio", label: "LM Studio" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "ollama", label: "Ollama" },
  { id: "groq", label: "Groq" },
];

type Props = {
  v: Voice;
  onBack: () => void;
};

export function SettingsPage({ v, onBack }: Props) {
  const disabled = v.sessionActive;
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [modelOptions, setModelOptions] = useState<{ id: string }[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const refreshKeyStatus = useCallback(async () => {
    if (providerNeedsApiKey(v.llmProvider)) {
      setKeySaved(await hasProviderApiKey(v.llmProvider));
    } else {
      setKeySaved(false);
    }
  }, [v.llmProvider]);

  useEffect(() => {
    void refreshKeyStatus();
    setApiKeyDraft("");
  }, [refreshKeyStatus]);

  useEffect(() => {
    setModelOptions([]);
  }, [v.llmProvider, v.lmBaseUrl]);

  const fetchModels = useCallback(async () => {
    setFetchingModels(true);
    try {
      const list = await listLlmModels({
        provider: v.llmProvider,
        baseUrl: v.lmBaseUrl.trim() || defaultBaseUrlForProvider(v.llmProvider),
      });
      setModelOptions(list.map((m) => ({ id: m.id })));
      if (list.length === 0) {
        toast.message("No models returned", {
          description: "Check that the provider is running and the base URL is correct.",
        });
      } else {
        toast.success(`Loaded ${list.length} models`);
      }
    } catch (err) {
      setModelOptions([]);
      toast.error("Could not fetch models", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFetchingModels(false);
    }
  }, [v.llmBaseUrl, v.llmProvider]);

  const persistNow = useCallback(async () => {
    await saveVoiceSettings({
      llmProvider: v.llmProvider,
      lmBaseUrl: v.lmBaseUrl,
      model: v.model,
      maxContextTokens: v.maxContextTokens,
      pushToTalk: v.pushToTalk,
      inputGain: v.inputGain,
      vadSensitivity: v.vadSensitivity,
      systemPrompt: v.systemPrompt,
      piperModel: v.piperModel,
      whisperModel: v.whisperModel,
      vadBargeIn: v.vadBargeIn,
      supertonicVoice: v.supertonicVoice,
      supertonicLang: v.supertonicLang,
      supertonicModel: v.supertonicModel,
    });
    toast.success("Settings saved to disk");
  }, [v]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void persistNow()}
          >
            <HardDrive className="size-3.5" />
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void v.applySettings()}
          >
            Save &amp; apply
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Tabs defaultValue="llm" className="mx-auto max-w-2xl">
          <TabsList className="mb-4">
            <TabsTrigger value="llm">LLM</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="tts">TTS</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          <TabsContent value="llm" className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={v.llmProvider === p.id ? "secondary" : "outline"}
                    disabled={disabled}
                    onClick={() => v.setLlmProvider(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lm-base">Base URL</Label>
              <Input
                id="lm-base"
                value={v.lmBaseUrl}
                onChange={(e) => v.setLmBaseUrl(e.target.value)}
                disabled={disabled}
                placeholder={
                  v.llmProvider === "ollama"
                    ? "http://127.0.0.1:11434"
                    : "http://127.0.0.1:1234"
                }
              />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="model-select">Model</Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  disabled={disabled || fetchingModels}
                  onClick={() => void fetchModels()}
                >
                  {fetchingModels ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Fetch models
                </Button>
              </div>
              <LlmModelSelect
                id="model-select"
                value={v.model}
                models={modelOptions}
                globalModel={v.model}
                disabled={disabled}
                loading={fetchingModels}
                placeholder={
                  modelOptions.length > 0 ? "Select model" : "Fetch models from provider"
                }
                triggerClassName="w-full font-mono text-xs"
                onValueChange={(id) => v.setModel(id)}
              />
            </div>
            {v.llmProvider === "lm_studio" && (
              <p className="text-muted-foreground text-xs">
                Enable Vision in LM Studio for the loaded model to use image attachments.
                PDF support depends on the specific model.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="max-ctx">Max context tokens</Label>
              <Input
                id="max-ctx"
                type="number"
                value={v.maxContextTokens}
                onChange={(e) =>
                  v.setMaxContextTokens(Number(e.target.value) || 128_000)
                }
                disabled={disabled}
              />
            </div>
            {providerNeedsApiKey(v.llmProvider) && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4" />
                  <Label>API key (OS keychain)</Label>
                  {keySaved && (
                    <span className="text-muted-foreground text-xs">
                      Saved
                    </span>
                  )}
                </div>
                <Input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  disabled={disabled}
                  placeholder="Paste API key"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled || !apiKeyDraft.trim()}
                    onClick={() => {
                      void setProviderApiKey(v.llmProvider, apiKeyDraft.trim()).then(
                        () => {
                          setApiKeyDraft("");
                          void refreshKeyStatus();
                          toast.success("API key saved to keychain");
                        },
                      );
                    }}
                  >
                    Save to keychain
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      void deleteProviderApiKey(v.llmProvider).then(() => {
                        void refreshKeyStatus();
                        toast.success("API key removed");
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="voice">
            <SettingsPanel v={v} disabled={disabled} section="voice" />
          </TabsContent>
          <TabsContent value="tts">
            <SettingsPanel v={v} disabled={disabled} section="tts" />
          </TabsContent>
          <TabsContent value="system">
            <SettingsPanel v={v} disabled={disabled} section="system" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
