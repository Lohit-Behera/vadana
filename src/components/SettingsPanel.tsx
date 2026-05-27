import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Download, HardDrive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { useVoiceSession } from "@/hooks/useVoiceSession";
import {
  checkSupertonicModel,
  onSupertonicDownload,
  startSupertonicDownload,
  type SupertonicModelStatus,
} from "@/lib/supertonic";
import {
  DEFAULT_VOICE_SYSTEM_PROMPT,
  saveVoiceSettings,
} from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SupertonicLangSelect } from "@/components/tts/SupertonicLangSelect";
import { SupertonicVoiceSelect } from "@/components/tts/SupertonicVoiceSelect";
import {
  normalizeSupertonicLang,
  normalizeSupertonicVoice,
} from "@/lib/supertonicOptions";

type Voice = ReturnType<typeof useVoiceSession>;

const WHISPER_PRESETS = ["tiny", "base", "small", "medium", "large"] as const;

type Props = {
  v: Voice;
  disabled: boolean;
  /** When set, only render that settings group (for tabbed settings page). */
  section?: "voice" | "tts" | "system" | "all";
};

function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span>{title}</span>
          <span className="text-muted-foreground text-xs font-normal group-open:hidden">
            {summary ?? "Show"}
          </span>
        </span>
      </summary>
      <div className="mt-3 space-y-3 pb-1">{children}</div>
    </details>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="space-y-1">
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-[width] duration-200"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <p className="text-muted-foreground text-right text-xs tabular-nums">
        {value}%
      </p>
    </div>
  );
}

function SupertonicDownloadBlock({
  modelId,
  modelsRoot,
  disabled,
}: {
  modelId: string;
  modelsRoot: string;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<SupertonicModelStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");

  const refresh = useCallback(async () => {
    const id = modelId.trim() || "supertonic-3";
    setChecking(true);
    try {
      const s = await checkSupertonicModel(id, modelsRoot);
      setStatus(s);
    } catch (e) {
      setStatus(null);
      toast.error("Could not check model", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChecking(false);
    }
  }, [modelId, modelsRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return onSupertonicDownload((ev) => {
      if (ev.type === "progress") {
        setDownloading(true);
        setProgress(ev.percent ?? 0);
        if (ev.message) setProgressMsg(ev.message);
      } else if (ev.type === "done") {
        setDownloading(false);
        setProgress(100);
        setProgressMsg(ev.message ?? "Done");
        if (ev.alreadyPresent) {
          toast.info("Model already present");
        } else {
          toast.success("Download complete");
        }
        void refresh();
      } else if (ev.type === "error") {
        setDownloading(false);
        setProgress(0);
        const msg = ev.message ?? "Download failed";
        setProgressMsg(msg);
        toast.error(msg);
      } else if (ev.type === "log" && ev.message) {
        setProgressMsg(ev.message);
      }
    });
  }, [refresh]);

  const present = status?.present === true;

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        {present ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="size-3.5 text-green-600" />
            Model already present
          </Badge>
        ) : (
          <Badge variant="outline">Not downloaded</Badge>
        )}
        {checking && (
          <span className="text-muted-foreground text-xs">Checking…</span>
        )}
      </div>
      {status?.cacheDir && (
        <p className="text-muted-foreground break-all text-xs">
          {status.cacheDir}
        </p>
      )}
      {downloading && (
        <ProgressBar value={progress} />
      )}
      {downloading && progressMsg && (
        <p className="text-muted-foreground text-xs">{progressMsg}</p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || downloading || checking}
        onClick={() => {
          const id = modelId.trim() || "supertonic-3";
          setDownloading(true);
          setProgress(0);
          setProgressMsg("Starting download…");
          void startSupertonicDownload(id, modelsRoot).catch((e: unknown) => {
            setDownloading(false);
            toast.error("Download failed", {
              description: e instanceof Error ? e.message : String(e),
            });
          });
        }}
      >
        <Download className="size-4" />
        {downloading
          ? `Downloading… ${progress}%`
          : present
            ? "Re-download weights"
            : "Download Supertonic weights"}
      </Button>
    </div>
  );
}

export function SettingsPanel({ v, disabled, section = "all" }: Props) {
  const show = (part: "voice" | "tts" | "system" | "llm") =>
    section === "all" || section === part;

  const persistNow = useCallback(async () => {
    await saveVoiceSettings(v.currentSettings());
    toast.success("Settings saved", {
      description: "Stored on disk (persists after restart).",
    });
  }, [v]);

  return (
    <div className="space-y-3">
      {section === "all" && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <HardDrive className="size-3.5 shrink-0" />
          Settings auto-save as you edit. Use &quot;Save &amp; apply&quot; to write
          to disk and push to an active session.
        </p>
      )}

      {show("voice") && (
      <Section
        title="Speech-to-text"
        summary="Turns your voice into text on this device"
        defaultOpen
      >
        <div className="space-y-1.5">
          <Label htmlFor="whisper">Recognition quality</Label>
          <Input
            id="whisper"
            value={v.whisperModel}
            onChange={(e) => v.setWhisperModel(e.target.value)}
            disabled={disabled}
            placeholder="small"
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {WHISPER_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant={v.whisperModel === preset ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={disabled}
                onClick={() => v.setWhisperModel(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Larger models are more accurate but slower. The first time you pick a
            size, it downloads in the background. Stop and start your session
            after changing this.
          </p>
        </div>
      </Section>
      )}

      {show("voice") && (
      <Section
        title="Microphone"
        summary="How the app listens and when you can interrupt"
        defaultOpen
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-2">
            <Label htmlFor="ptt" className="text-sm font-normal">
              Hold button to speak
            </Label>
            <p className="text-muted-foreground text-xs">
              Off: listens automatically when you talk
            </p>
          </div>
          <Switch
            id="ptt"
            checked={v.pushToTalk}
            onCheckedChange={v.setPushToTalk}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-2">
            <Label htmlFor="barge" className="text-sm font-normal">
              Stop assistant when I speak
            </Label>
            <p className="text-muted-foreground text-xs">
              Lets you jump in while it is talking
            </p>
          </div>
          <Switch
            id="barge"
            checked={v.vadBargeIn}
            onCheckedChange={v.setVadBargeIn}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <Label>Microphone volume</Label>
            <span className="text-muted-foreground tabular-nums">
              {v.inputGain.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[v.inputGain]}
            min={0.25}
            max={2}
            step={0.05}
            onValueChange={(x) => v.setInputGain(x[0] ?? 1)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <Label>Listening sensitivity</Label>
            <span className="text-muted-foreground tabular-nums">
              {v.vadSensitivity.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[v.vadSensitivity]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(x) => v.setVadSensitivity(x[0] ?? 0.5)}
            disabled={disabled}
          />
          <p className="text-muted-foreground text-xs">
            Higher picks up quieter speech; lower ignores more background noise.
          </p>
        </div>
      </Section>
      )}

      {show("tts") && (
      <Section title="Text-to-speech" summary="Supertonic / Piper" defaultOpen>
        <div className="grid gap-3 sm:grid-cols-3">
          <SupertonicVoiceSelect
            id="stv"
            label="Voice"
            value={normalizeSupertonicVoice(v.supertonicVoice)}
            onValueChange={(val) => v.setSupertonicVoice(val)}
            disabled={disabled}
            className="space-y-1.5"
          />
          <SupertonicLangSelect
            id="stl"
            label="Lang"
            value={normalizeSupertonicLang(v.supertonicLang)}
            onValueChange={(val) => v.setSupertonicLang(val)}
            disabled={disabled}
            className="space-y-1.5"
          />
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="stm">Model id</Label>
            <Input
              id="stm"
              value={v.supertonicModel}
              onChange={(e) => v.setSupertonicModel(e.target.value)}
              disabled={disabled}
              placeholder="supertonic-3"
            />
          </div>
        </div>

        <SupertonicDownloadBlock
          modelId={v.supertonicModel}
          modelsRoot={v.modelsRoot}
          disabled={disabled}
        />

        <div className="space-y-1.5">
          <Label>Piper path (optional)</Label>
          <Input
            value={v.piperModel}
            onChange={(e) => v.setPiperModel(e.target.value)}
            disabled={disabled}
            placeholder="path\to\voice.onnx"
          />
        </div>
      </Section>
      )}

      {show("system") && (
      <Section title="System prompt" summary="Assistant behavior">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Shipped default includes optional Supertonic 3 expression tags.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={
              disabled ||
              v.systemPrompt.trim() === DEFAULT_VOICE_SYSTEM_PROMPT.trim()
            }
            onClick={() => {
              v.setSystemPrompt(DEFAULT_VOICE_SYSTEM_PROMPT);
              toast.success("System prompt reset to default");
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset to default
          </Button>
        </div>
        <Textarea
          rows={12}
          value={v.systemPrompt}
          onChange={(e) => v.setSystemPrompt(e.target.value)}
          disabled={disabled}
          className="font-mono text-xs leading-relaxed"
        />
      </Section>
      )}

      {section === "all" && (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void persistNow()}
      >
        <HardDrive className="size-4" />
        Save settings to disk now
      </Button>
      )}
    </div>
  );
}
