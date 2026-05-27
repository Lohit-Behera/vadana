import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LLM_MODEL_CUSTOM_VALUE,
  LLM_MODEL_DEFAULT_VALUE,
} from "@/lib/llmProviders";
import { cn } from "@/lib/utils";

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
  /** Adds "Custom model ID…" and a text field when selected. */
  allowCustom?: boolean;
  customModelId?: string;
  onCustomModelIdChange?: (value: string) => void;
  customPlaceholder?: string;
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
  allowCustom = false,
  customModelId = "",
  onCustomModelIdChange,
  customPlaceholder = "e.g. anthropic/claude-sonnet-4",
  disabled,
  loading,
  placeholder = "Select model",
  className,
  triggerClassName,
  size = "default",
}: Props) {
  const [open, setOpen] = useState(false);
  const storedId = value.trim();
  const isCustomSelection = storedId === LLM_MODEL_CUSTOM_VALUE;
  const selectValue = isCustomSelection
    ? LLM_MODEL_CUSTOM_VALUE
    : allowDefault && (!storedId || value === LLM_MODEL_DEFAULT_VALUE)
      ? LLM_MODEL_DEFAULT_VALUE
      : storedId || globalModel;

  const items = useMemo(() => {
    const modelIds = new Set(models.map((m) => m.id));
    const extraIds =
      selectValue &&
      selectValue !== LLM_MODEL_DEFAULT_VALUE &&
      selectValue !== LLM_MODEL_CUSTOM_VALUE &&
      !modelIds.has(selectValue)
        ? [selectValue]
        : [];
    return { extraIds, models };
  }, [models, selectValue]);

  const showCustomInput =
    allowCustom &&
    (isCustomSelection ||
      (Boolean(customModelId.trim()) &&
        !models.some((m) => m.id === customModelId.trim()) &&
        selectValue === customModelId.trim()));

  const triggerLabel = useMemo(() => {
    if (loading) return "Loading models…";
    if (isCustomSelection) {
      return customModelId.trim() || "Custom model ID…";
    }
    if (selectValue === LLM_MODEL_DEFAULT_VALUE) {
      return `Settings default (${globalModel})`;
    }
    if (selectValue === LLM_MODEL_CUSTOM_VALUE) {
      return "Custom model ID…";
    }
    return selectValue || placeholder;
  }, [
    loading,
    isCustomSelection,
    customModelId,
    selectValue,
    globalModel,
    placeholder,
  ]);

  const pick = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  return (
    <div className={className}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || loading}
            className={cn(
              "w-full justify-between font-normal",
              size === "sm" ? "h-9 px-3 text-xs" : "h-10 px-3.5 text-sm",
              !selectValue && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate font-mono">{triggerLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-(--radix-dropdown-menu-trigger-width) min-w-[min(100%,22rem)] p-0"
          align="start"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Command
            filter={(cmdValue, search) => {
              if (!search.trim()) return 1;
              return cmdValue.toLowerCase().includes(search.trim().toLowerCase())
                ? 1
                : 0;
            }}
          >
            <CommandInput placeholder="Search models…" className="text-xs" />
            <CommandList className="max-h-64">
              <CommandEmpty>No models match your search.</CommandEmpty>
              {(allowDefault || allowCustom || items.extraIds.length > 0) && (
                <CommandGroup>
                  {allowDefault && (
                    <CommandItem
                      value={`settings default ${globalModel}`}
                      onSelect={() => pick(LLM_MODEL_DEFAULT_VALUE)}
                    >
                      <span className="truncate">
                        Settings default ({globalModel})
                      </span>
                      <Check
                        className={cn(
                          "ml-auto size-3.5 shrink-0",
                          selectValue === LLM_MODEL_DEFAULT_VALUE
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  )}
                  {allowCustom && (
                    <CommandItem
                      value="custom model id"
                      onSelect={() => pick(LLM_MODEL_CUSTOM_VALUE)}
                    >
                      Custom model ID…
                      <Check
                        className={cn(
                          "ml-auto size-3.5 shrink-0",
                          selectValue === LLM_MODEL_CUSTOM_VALUE
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  )}
                  {items.extraIds.map((mid) => (
                    <CommandItem
                      key={`saved-${mid}`}
                      value={mid}
                      onSelect={() => pick(mid)}
                    >
                      <span className="truncate font-mono">{mid}</span>
                      <Check
                        className={cn(
                          "ml-auto size-3.5 shrink-0",
                          selectValue === mid ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {items.models.length > 0 &&
                (allowDefault || allowCustom || items.extraIds.length > 0) && (
                  <CommandSeparator />
                )}
              {items.models.length > 0 && (
                <CommandGroup heading="Models">
                  {items.models.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      onSelect={() => pick(m.id)}
                    >
                      <span className="truncate font-mono">{m.id}</span>
                      <Check
                        className={cn(
                          "ml-auto size-3.5 shrink-0",
                          selectValue === m.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DropdownMenuContent>
      </DropdownMenu>
      {showCustomInput && onCustomModelIdChange && (
        <Input
          className="mt-2 font-mono text-xs"
          value={customModelId}
          onChange={(e) => onCustomModelIdChange(e.target.value)}
          placeholder={customPlaceholder}
          disabled={disabled}
          aria-label="Custom model ID"
        />
      )}
    </div>
  );
}
