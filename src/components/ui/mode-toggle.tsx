import * as React from "react";
import { flushSync } from "react-dom";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useTheme, type Theme } from "@/components/ui/theme-provider";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeSetting() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Appearance</Label>
        <p className="text-muted-foreground text-xs">
          Choose light, dark, or match your system setting.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={theme === value ? "secondary" : "outline"}
            className="gap-1.5"
            onClick={() => setTheme(value)}
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ModeToggle({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const ref = React.useRef<HTMLButtonElement>(null);

  const toggle = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const handleClick = async () => {
    if (
      !ref.current ||
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      toggle();
      return;
    }

    await document.startViewTransition(() => {
      flushSync(() => {
        toggle();
      });
    }).ready;

    const { top, left, width, height } = ref.current.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const right = window.innerWidth - left;
    const bottom = window.innerHeight - top;
    const maxRadius = Math.hypot(Math.max(left, right), Math.max(top, bottom));

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 500,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  };

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn(className)}
      onClick={() => void handleClick()}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
