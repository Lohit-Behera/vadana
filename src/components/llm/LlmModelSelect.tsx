import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LLM_MODEL_DEFAULT_VALUE } from "@/lib/llmProviders";

export type LlmModelOption = {
  id: string;
};

type Props = {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  models: LlmModelOption[];
  /** Shown on the Settings default item when allowDefault is true. */
  globalModel?: string;
  allowDefault?: boolean;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  size?: "sm" | "default";
};

export function LlmModelSelect({
  id,
  label,
  value,
  onValueChange,
  models,
  globalModel = "local-model",
  allowDefault = false,
  disabled,
  loading,
  placeholder = "Select model",
  className,
  triggerClassName,
  size = "default",
}: Props) {
  const storedId = value.trim();
  const selectValue =
    allowDefault && (!storedId || value === LLM_MODEL_DEFAULT_VALUE)
      ? LLM_MODEL_DEFAULT_VALUE
      : storedId || globalModel;

  const items = useMemo(() => {
    const modelIds = new Set(models.map((m) => m.id));
    const extraIds =
      selectValue &&
      selectValue !== LLM_MODEL_DEFAULT_VALUE &&
      !modelIds.has(selectValue)
        ? [selectValue]
        : [];
    return { extraIds, models };
  }, [models, selectValue]);

  return (
    <div className={className}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Select
        value={selectValue}
        onValueChange={onValueChange}
        disabled={disabled || loading}
        modal={false}
      >
        <SelectTrigger id={id} size={size} className={triggerClassName ?? "w-full"}>
          <SelectValue placeholder={loading ? "Loading models…" : placeholder} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          className="max-h-64 w-(--radix-select-trigger-width)"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {allowDefault && (
            <SelectItem value={LLM_MODEL_DEFAULT_VALUE}>
              Settings default ({globalModel})
            </SelectItem>
          )}
          {items.extraIds.map((mid) => (
            <SelectItem key={`saved-${mid}`} value={mid}>
              {mid}
            </SelectItem>
          ))}
          {items.models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
