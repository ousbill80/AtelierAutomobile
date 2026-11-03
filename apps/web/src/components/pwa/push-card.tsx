"use client";

// Réglage des notifications push sur cet appareil (téléphone, tablette, ordinateur).
import { BellOff, BellRing, Send } from "lucide-react";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/client";
import { t } from "@/i18n/t";
import { usePush } from "./use-push";

export function PushCard() {
  const push = usePush();
  const test = trpc.notifications.push.test.useMutation();
  const utils = trpc.useUtils();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {push.status === "on" ? (
          <StatusBadge tone="ok">
            <BellRing size={14} aria-hidden /> {t("pwa.push.statusOn")}
          </StatusBadge>
        ) : push.status === "loading" ? null : (
          <StatusBadge tone="off">
            <BellOff size={14} aria-hidden /> {t("pwa.push.statusOff")}
          </StatusBadge>
        )}
        {push.devices > 0 ? (
          <span className="text-xs text-muted">
            {t(push.devices > 1 ? "pwa.push.devicesMany" : "pwa.push.devicesOne", {
              count: push.devices,
            })}
          </span>
        ) : null}
      </div>

      {push.status === "loading" && (
        <div className="h-11 w-48 animate-pulse rounded-md bg-surface-2" />
      )}
      {push.status === "unsupported" && (
        <p className="text-sm text-muted">{t("pwa.push.unsupported")}</p>
      )}
      {push.status === "ios-install" && (
        <p className="text-sm text-muted">{t("pwa.push.iosInstall")}</p>
      )}
      {push.status === "server-off" && (
        <p className="text-sm text-muted">{t("pwa.push.serverOff")}</p>
      )}
      {push.status === "denied" && (
        <p className="text-sm text-status-warn">{t("pwa.push.denied")}</p>
      )}

      {push.status === "off" && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">{t("pwa.push.offHint")}</p>
          <Button onClick={() => void push.enable()} disabled={push.busy}>
            <BellRing size={16} aria-hidden />
            {push.busy ? t("pwa.push.enabling") : t("pwa.push.enable")}
          </Button>
        </div>
      )}

      {push.status === "on" && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={test.isPending}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: () => {
                  void utils.notifications.unreadCount.invalidate();
                  void utils.notifications.list.invalidate();
                },
              })
            }
          >
            <Send size={16} aria-hidden />
            {t("pwa.push.test")}
          </Button>
          <Button variant="ghost" onClick={() => void push.disable()} disabled={push.busy}>
            {t("pwa.push.disable")}
          </Button>
        </div>
      )}
      {test.isSuccess && <p className="text-sm text-status-ok">{t("pwa.push.testSent")}</p>}
      {test.error && <p className="text-sm text-status-bad">{test.error.message}</p>}
      {push.error === "permission" && (
        <p className="text-sm text-status-warn">{t("pwa.push.denied")}</p>
      )}
      {push.error === "failed" && <p className="text-sm text-status-bad">{t("pwa.push.failed")}</p>}
    </div>
  );
}
