import { Loader, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  status: "loading" | "failed";
  title: string;
  description?: string;
  error?: string | null;
  busy?: boolean;
  onRetry?: () => void;
};

export function BackendStartupScreen({
  status,
  title,
  description,
  error,
  busy = false,
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
        {status === "failed" && error && (
          <p className="text-destructive/90 pt-1 text-sm leading-relaxed">
            {error}
          </p>
        )}
      </div>

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
