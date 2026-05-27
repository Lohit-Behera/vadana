import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  HardDrive,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { LlmModelSelect } from "@/components/llm/LlmModelSelect";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listLlmModels } from "@/lib/llmModels";
import {
  defaultBaseUrlForProvider,
  LLM_MODEL_CUSTOM_VALUE,
} from "@/lib/llmProviders";
import { ModelsFolderSetting } from "@/components/settings/ModelsFolderSetting";
import { ThemeSetting } from "@/components/ui/mode-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
  { id: "openrouter", label: "OpenRouter" },
];

type Props = {
  v: Voice;
  onBack: () => void;
};

export function SettingsPage({ v, onBack }: Props) {
  const disabled = v.sessionActive;
  const [updateBusy, setUpdateBusy] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [modelOptions, setModelOptions] = useState<{ id: string }[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [customModelPicker, setCustomModelPicker] = useState(false);

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
  }, [v.lmBaseUrl, v.llmProvider]);

  const persistNow = useCallback(async () => {
    await saveVoiceSettings(v.currentSettings());
    toast.success("Settings saved to disk");
  }, [v]);

  const checkUpdates = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const update = await checkForUpdate();
      if (!update) {
        toast.success("You're up to date");
        return;
      }

      toast.message(`Update available: ${update.version}`, {
        description: "Downloading and installing now…",
      });

      await update.downloadAndInstall();
      toast.success("Update installed", { description: "Restarting…" });
      await relaunch();
    } catch (err) {
      toast.error("Update check failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass-surface flex items-center gap-3 border-b px-5 py-3.5">
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

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <Tabs defaultValue="llm" className="mx-auto max-w-3xl">
          <TabsList className="mb-5">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="llm">LLM</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="tts">TTS</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="glass-surface space-y-6 rounded-2xl p-5">
            <ThemeSetting />
            <ModelsFolderSetting
              value={v.modelsRoot}
              onChange={v.setModelsRoot}
              disabled={disabled}
            />
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Updates</Label>
                  <p className="text-muted-foreground text-xs">
                    Checks for a new Vadana release and installs it.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  disabled={updateBusy}
                  onClick={() => void checkUpdates()}
                >
                  {updateBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUpRight className="size-3.5" />
                  )}
                  {updateBusy ? "Checking…" : "Check for updates"}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Note: updater only works in installed builds (not during{" "}
                <code className="font-mono">pnpm tauri dev</code>).
              </p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Voice backend</Label>
                  <p className="text-muted-foreground text-xs">
                    {v.backendConnected
                      ? `Connected (port ${v.wsPort})`
                      : v.backendConnecting
                        ? "Connecting..."
                        : "Not connected"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  disabled={disabled || v.backendConnecting}
                  onClick={() => void v.connectBackend()}
                >
                  {v.backendConnecting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="size-3.5" />
                  )}
                  {v.backendConnecting
                    ? "Connecting"
                    : v.backendConnected
                      ? "Reconnect backend"
                      : "Connect backend"}
                </Button>
              </div>
              {!v.backendConnected && (
                <p className="text-muted-foreground text-xs">
                  Start is disabled until backend connection succeeds.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="llm" className="glass-surface space-y-5 rounded-2xl p-5">
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2.5">
                {PROVIDERS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={v.llmProvider === p.id ? "secondary" : "outline"}
                    disabled={disabled}
                    onClick={() => {
                      v.setLlmProvider(p.id);
                      setCustomModelPicker(false);
                    }}
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
                placeholder={defaultBaseUrlForProvider(v.llmProvider)}
              />
            </div>
            <div className="space-y-2.5">
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
                value={customModelPicker ? LLM_MODEL_CUSTOM_VALUE : v.model}
                models={modelOptions}
                globalModel={v.model}
                allowCustom
                customModelId={v.model}
                onCustomModelIdChange={v.setModel}
                customPlaceholder={
                  v.llmProvider === "openrouter"
                    ? "e.g. anthropic/claude-sonnet-4"
                    : "Paste model id from provider docs"
                }
                disabled={disabled}
                loading={fetchingModels}
                placeholder={
                  modelOptions.length > 0 ? "Select model" : "Fetch models from provider"
                }
                triggerClassName="w-full font-mono text-xs"
                onValueChange={(id) => {
                  if (id === LLM_MODEL_CUSTOM_VALUE) {
                    setCustomModelPicker(true);
                  } else {
                    setCustomModelPicker(false);
                    v.setModel(id);
                  }
                }}
              />
            </div>
            {v.llmProvider === "lm_studio" && (
              <p className="text-muted-foreground text-xs">
                Enable Vision in LM Studio for the loaded model to use image attachments.
                PDF support depends on the specific model.
              </p>
            )}
              <div className="space-y-2">
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
              <div className="glass-surface space-y-3 rounded-xl p-4">
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
