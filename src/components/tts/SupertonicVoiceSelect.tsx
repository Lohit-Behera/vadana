import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPERTONIC_DEFAULT_VALUE,
  SUPERTONIC_VOICES,
  normalizeSupertonicVoice,
} from "@/lib/supertonicOptions";

type Props = {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  allowDefault?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: "sm" | "default";
};

export function SupertonicVoiceSelect({
  id,
  label,
  value,
  onValueChange,
  disabled,
  allowDefault = false,
  className,
  triggerClassName,
  size = "default",
}: Props) {
  const selectValue = allowDefault
    ? value === SUPERTONIC_DEFAULT_VALUE || !value.trim()
      ? SUPERTONIC_DEFAULT_VALUE
      : normalizeSupertonicVoice(value)
    : normalizeSupertonicVoice(value);

  return (
    <div className={className}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Select value={selectValue} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} size={size} className={triggerClassName ?? "w-full"}>
          <SelectValue placeholder="Voice" />
        </SelectTrigger>
        <SelectContent>
          {allowDefault && (
            <SelectItem value={SUPERTONIC_DEFAULT_VALUE}>Settings default</SelectItem>
          )}
          <SelectGroup>
            <SelectLabel>Female</SelectLabel>
            {SUPERTONIC_VOICES.filter((x) => x.group === "female").map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Male</SelectLabel>
            {SUPERTONIC_VOICES.filter((x) => x.group === "male").map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
