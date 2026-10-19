"use client";

import { Button } from "@atelieros/ui";
import { t } from "./i18n";

export function ErrorBox({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4"
    >
      <p className="text-sm text-status-bad">⚠ {message ?? t("loadError")}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}
