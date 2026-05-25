import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPERTONIC_DEFAULT_VALUE,
  SUPERTONIC_LANGUAGES,
  normalizeSupertonicLang,
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

export function SupertonicLangSelect({
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
      : normalizeSupertonicLang(value)
    : normalizeSupertonicLang(value);

  return (
    <div className={className}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Select value={selectValue} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} size={size} className={triggerClassName ?? "w-full"}>
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {allowDefault && (
            <SelectItem value={SUPERTONIC_DEFAULT_VALUE}>Settings default</SelectItem>
          )}
          {SUPERTONIC_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.label} ({lang.code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
