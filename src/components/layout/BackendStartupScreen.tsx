import { Loader, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  status: "loading" | "failed";
  title: string;
  description?: string;
  error?: string | null;
  busy?: boolean;
  steps?: string[];
  currentStep?: number;
  onRetry?: () => void;
};

export function BackendStartupScreen({
  status,
  title,
  description,
  error,
  busy = false,
  steps,
  currentStep = 0,
  onRetry,
}: Props) {
  return (
    <div className="bg-background flex h-dvh w-full flex-col items-center justify-center gap-6 px-6">
      {status === "loading" ? (
        <Loader
          className="text-primary size-14 animate-spin"
          strokeWidth={1.5}
          aria-hidden
        />
      ) : (
        <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
          <RefreshCw className="text-destructive size-7" aria-hidden />
        </div>
      )}

      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        )}
        {status === "loading" && (
          <p className="text-muted-foreground/90 pt-1 text-xs leading-relaxed">
            Note: first run can take a little longer while local backend dependencies and models initialize.
          </p>
        )}
        {status === "failed" && error && (
          <p className="text-destructive/90 pt-1 text-sm leading-relaxed">
            {error}
          </p>
        )}
      </div>
      {status === "loading" && steps && steps.length > 0 && (
        <div className="bg-muted/40 w-full max-w-md rounded-xl border p-3 text-left">
          <ol className="space-y-2 text-sm">
            {steps.map((step, idx) => {
              const done = idx < currentStep;
              const active = idx === currentStep;
              return (
                <li
                  key={step}
                  className={
                    done
                      ? "text-muted-foreground"
                      : active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/80"
                  }
                >
                  <span className="mr-2 inline-block w-5 text-right">
                    {done ? "✓" : `${idx + 1}.`}
                  </span>
                  {step}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {status === "failed" && onRetry && (
        <Button
          type="button"
          size="lg"
          className="gap-2 rounded-full px-8"
          disabled={busy}
          onClick={onRetry}
        >
          {busy ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {busy ? "Connecting…" : "Retry"}
        </Button>
      )}
    </div>
  );
}
