"use client";

import { Button } from "@atelieros/ui";
import { t } from "./i18n";

export function ErrorBox({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
      <p className="text-sm text-status-bad">{message ?? t("loadError")}</p>
      <Button variant="secondary" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
