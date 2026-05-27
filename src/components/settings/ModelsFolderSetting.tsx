import { FolderOpen, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  effectiveModelsRoot,
  getDefaultModelsRoot,
  pickModelsFolder,
} from "@/lib/modelsRoot";

type Props = {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
};

export function ModelsFolderSetting({ value, onChange, disabled }: Props) {
  const [defaultRoot, setDefaultRoot] = useState("");

  useEffect(() => {
    void getDefaultModelsRoot().then(setDefaultRoot);
  }, []);

  const displayRoot = effectiveModelsRoot(value, defaultRoot);

  const browse = useCallback(async () => {
    const picked = await pickModelsFolder(displayRoot);
    if (picked) onChange(picked);
  }, [displayRoot, onChange]);

  const resetDefault = useCallback(() => {
    onChange("");
  }, [onChange]);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Models folder</Label>
        <p className="text-muted-foreground text-xs">
          Whisper saves under <code className="text-xs">whisper\</code>, Supertonic
          under <code className="text-xs">supertonic\</code>. Stop the session after
          changing this path.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={defaultRoot || "%USERPROFILE%\\vadana\\models"}
          className="font-mono text-xs"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            disabled={disabled}
            onClick={() => void browse()}
          >
            <FolderOpen className="size-3.5" />
            Browse
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={disabled || !value.trim()}
            onClick={resetDefault}
            title="Use default folder"
          >
            <RotateCcw className="size-3.5" />
            Default
          </Button>
        </div>
      </div>
      {displayRoot && (
        <p className="text-muted-foreground break-all text-xs">
          Using: {displayRoot}
        </p>
      )}
    </div>
  );
}
