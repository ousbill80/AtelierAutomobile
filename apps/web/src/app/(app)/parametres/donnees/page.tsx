"use client";

// M15 §7 `/parametres/donnees` — mode de fonctionnement (RG-M15-23), sauvegardes (RG-M15-24,
// information seule), export complet (US-M15-08, RG-M15-21), accès support (RG-M15-27) et
// suppression du compte en zone rouge (US-M15-09, RG-M15-22). Réservé à `settings:billing`.
import { useState } from "react";
import { formatDate } from "@atelieros/core/calendar";
import { Button, Field, Input, OtpInput, PageHead, StatusBadge, Textarea } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const EXPORT_TONE: Record<string, "ok" | "warn" | "bad" | "off"> = {
  PENDING: "off",
  RUNNING: "warn",
  READY: "ok",
  FAILED: "bad",
  EXPIRED: "off",
};
const EXPORT_ICON: Record<string, string> = {
  PENDING: "⏳",
  RUNNING: "⏳",
  READY: "✓",
  FAILED: "✕",
  EXPIRED: "—",
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mo`;
}

/** Étape OTP commune à l'export et à la suppression (M15 §10 : code frais < 5 min). */
function OtpStep({
  code,
  onCode,
  disabled,
}: {
  code: string;
  onCode: (value: string) => void;
  disabled?: boolean;
}) {
  const send = trpc.org.sendSecurityCode.useMutation();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t("dataSettings.otpTitle")}</p>
      <Button
        variant="secondary"
        className="min-h-11 self-start"
        loading={send.isPending}
        disabled={disabled}
        onClick={() => send.mutate()}
      >
        {send.isSuccess ? t("dataSettings.otpResend") : t("dataSettings.otpSend")}
      </Button>
      {send.data ? (
        <p role="status" className="text-sm text-muted">
          {t("dataSettings.otpSent", { destination: send.data.destination })}
        </p>
      ) : null}
      {send.error ? (
        <p role="alert" className="error">
          {send.error.message}
        </p>
      ) : null}
      {send.isSuccess ? <OtpInput value={code} onChange={onCode} disabled={disabled} /> : null}
    </div>
  );
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function DataSettingsPage() {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const exports = trpc.dataExport.list.useQuery(undefined, {
    // Rafraîchit tant qu'une archive est en préparation.
    refetchInterval: (query) =>
      query.state.data?.some((e) => e.status === "PENDING" || e.status === "RUNNING")
        ? 5_000
        : false,
  });
  const support = trpc.support.get.useQuery();

  const [modeReason, setModeReason] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCode, setExportCode] = useState("");
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionCode, setDeletionCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const refreshOrg = () => {
    void utils.me.get.invalidate();
    void utils.plan.get.invalidate();
  };
  const setMode = trpc.org.setOperatingMode.useMutation({
    onSuccess: () => {
      setModeReason("");
      setNotice(t("dataSettings.modeSaved"));
      refreshOrg();
    },
  });
  const requestExport = trpc.dataExport.request.useMutation({
    onSuccess: () => {
      setExportOpen(false);
      setExportCode("");
      setNotice(t("dataSettings.exportStarted"));
      void utils.dataExport.list.invalidate();
    },
  });
  const grant = trpc.support.grantAccess.useMutation({
    onSuccess: () => void utils.support.get.invalidate(),
  });
  const revoke = trpc.support.revokeAccess.useMutation({
    onSuccess: () => void utils.support.get.invalidate(),
  });
  const requestDeletion = trpc.org.requestDeletion.useMutation({
    onSuccess: () => {
      setDeletionOpen(false);
      setDeletionCode("");
      setConfirmName("");
      refreshOrg();
    },
  });
  const cancelDeletion = trpc.org.cancelDeletion.useMutation({
    onSuccess: () => {
      setNotice(t("dataSettings.deletionCancelled"));
      refreshOrg();
    },
  });

  if (me.isError || exports.isError || support.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm text-status-bad">{t("dataSettings.loadError")}</p>
        <Button
          variant="secondary"
          onClick={() => {
            void me.refetch();
            void exports.refetch();
            void support.refetch();
          }}
        >
          {t("dataSettings.retry")}
        </Button>
      </div>
    );
  }
  const org = me.data?.activeOrganization;
  if (!org || !exports.data || !support.data) return <Skeletons />;

  const timeZone = org.timezone;
  const scheduled = org.lifecycleStatus === "DELETION_SCHEDULED";
  const readOnly = org.lifecycleStatus !== "ACTIVE";
  const otherMode = org.operatingMode === "FULL" ? "REMINDERS_ONLY" : "FULL";

  return (
    <div className="flex flex-col gap-6">
      <PageHead title={t("dataSettings.title")} description={t("dataSettings.description")} />
      {notice ? (
        <p role="status" className="text-sm text-status-ok">
          ✓ {notice}
        </p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="font-semibold">{t("dataSettings.modeTitle")}</h3>
        <p className="text-sm">
          {t("dataSettings.modeCurrent", { mode: t(`dataSettings.modes.${org.operatingMode}`) })}
        </p>
        <Field label={t("dataSettings.modeReasonLabel")}>
          <Input
            value={modeReason}
            disabled={readOnly}
            maxLength={500}
            onChange={(e) => setModeReason(e.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          className="min-h-11 self-start"
          disabled={readOnly || modeReason.trim().length === 0}
          loading={setMode.isPending}
          onClick={() => setMode.mutate({ mode: otherMode, reason: modeReason.trim() })}
        >
          {t("dataSettings.modeSwitch", { mode: t(`dataSettings.modes.${otherMode}`) })}
        </Button>
        {setMode.error ? (
          <p role="alert" className="error">
            {setMode.error.message}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="font-semibold">{t("dataSettings.backupTitle")}</h3>
        <p className="text-sm text-muted">{t("dataSettings.backupInfo")}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="font-semibold">{t("dataSettings.exportTitle")}</h3>
        <p className="text-sm text-muted">{t("dataSettings.exportInfo")}</p>
        {!exportOpen ? (
          <Button
            className="min-h-11 self-start"
            onClick={() => {
              requestExport.reset();
              setExportOpen(true);
            }}
          >
            {t("dataSettings.exportAction")}
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <OtpStep code={exportCode} onCode={setExportCode} />
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={exportCode.length !== 6}
                loading={requestExport.isPending}
                onClick={() => requestExport.mutate({ otp: exportCode })}
              >
                {t("dataSettings.otpConfirm")}
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setExportOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
            {requestExport.error ? (
              <p role="alert" className="error">
                {requestExport.error.message}
              </p>
            ) : null}
          </div>
        )}

        {exports.data.length === 0 ? (
          <p className="text-sm text-muted">{t("dataSettings.exportsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("dataSettings.exportTitle")}>
            {exports.data.map((row) => (
              <li
                key={row.id}
                data-testid={`export-${row.id}`}
                className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span>
                    {t("dataSettings.exportsTable.date")} :{" "}
                    {formatDate(new Date(row.createdAt), timeZone)}
                  </span>
                  <StatusBadge tone={EXPORT_TONE[row.status] ?? "off"}>
                    <span aria-hidden="true">{EXPORT_ICON[row.status] ?? ""} </span>
                    {t(`dataSettings.exportStatus.${row.status}`)}
                  </StatusBadge>
                  {row.status === "READY" ? (
                    <span className="text-muted">
                      {t("dataSettings.exportsTable.size")} : {formatSize(row.sizeBytes)} ·{" "}
                      {t("dataSettings.exportsTable.expires")} :{" "}
                      {row.expiresAt ? formatDate(new Date(row.expiresAt), timeZone) : "—"}
                    </span>
                  ) : null}
                  {row.error ? <span className="text-status-bad">{row.error}</span> : null}
                </div>
                {row.downloadable ? (
                  <a
                    className="btn btn-primary min-h-11"
                    href={`/api/exports/${row.id}`}
                    data-testid="export-download"
                  >
                    {t("dataSettings.download")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="font-semibold">{t("dataSettings.supportTitle")}</h3>
        <p className="text-sm text-muted">{t("dataSettings.supportInfo")}</p>
        <p className="text-sm">
          {support.data.active && support.data.until
            ? t("dataSettings.supportActive", {
                date: formatDate(new Date(support.data.until), timeZone),
              })
            : t("dataSettings.supportInactive")}
        </p>
        {support.data.active ? (
          <Button
            variant="secondary"
            className="min-h-11 self-start"
            disabled={readOnly}
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {t("dataSettings.supportRevoke")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="min-h-11 self-start"
            disabled={readOnly}
            loading={grant.isPending}
            onClick={() => grant.mutate({ hours: 24 })}
          >
            {t("dataSettings.supportGrant")}
          </Button>
        )}
      </section>

      <section
        className="flex flex-col gap-3 rounded-lg border border-status-bad p-4"
        aria-labelledby="deletion-title"
      >
        <h3 id="deletion-title" className="font-semibold text-status-bad">
          {t("dataSettings.deletionTitle")}
        </h3>
        <p className="text-sm">{t("dataSettings.deletionInfo")}</p>
        {scheduled ? (
          <>
            <p role="status" className="text-sm font-medium">
              ⚠{" "}
              {t("dataSettings.deletionScheduled", {
                date: org.deletionScheduledFor
                  ? formatDate(new Date(org.deletionScheduledFor), timeZone)
                  : "—",
              })}
            </p>
            <Button
              className="min-h-11 self-start"
              loading={cancelDeletion.isPending}
              onClick={() => cancelDeletion.mutate()}
            >
              {t("dataSettings.deletionCancel")}
            </Button>
            {cancelDeletion.error ? (
              <p role="alert" className="error">
                {cancelDeletion.error.message}
              </p>
            ) : null}
          </>
        ) : !deletionOpen ? (
          <Button
            variant="danger"
            className="min-h-11 self-start"
            disabled={readOnly}
            onClick={() => {
              requestDeletion.reset();
              setDeletionOpen(true);
            }}
          >
            {t("dataSettings.deletionAction")}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label={t("dataSettings.deletionConfirmLabel", { name: org.name })}>
              <Input
                value={confirmName}
                autoComplete="off"
                onChange={(e) => setConfirmName(e.target.value)}
              />
            </Field>
            <Field label={t("dataSettings.deletionReasonLabel")}>
              <Textarea
                value={deletionReason}
                maxLength={500}
                onChange={(e) => setDeletionReason(e.target.value)}
              />
            </Field>
            <OtpStep code={deletionCode} onCode={setDeletionCode} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                className="min-h-11"
                disabled={confirmName.trim().length === 0 || deletionCode.length !== 6}
                loading={requestDeletion.isPending}
                onClick={() =>
                  requestDeletion.mutate({
                    confirmName,
                    otp: deletionCode,
                    reason: deletionReason.trim() || undefined,
                  })
                }
              >
                {t("dataSettings.deletionSubmit")}
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setDeletionOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
            {requestDeletion.error ? (
              <p role="alert" className="error">
                {requestDeletion.error.message}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
