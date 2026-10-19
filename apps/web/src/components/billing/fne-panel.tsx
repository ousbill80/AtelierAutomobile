"use client";

// M08 §7 — bloc FNE de /factures/[id] : numéro fiscal et date (CERTIFIED / MANUAL), bandeau
// d'attente ou d'échec avec `fneError` en français, « Réessayer » (mode API) et « Saisir le
// numéro FNE » (RG-M08-17), réservés à `fne:manage`.
import { useState } from "react";
import { Button, Input, Modal } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { t } from "./i18n";

interface FneInvoice {
  id: string;
  status: string;
  fneStatus: string;
  fneNumber: string | null;
  fneCertifiedAt: string | Date | null;
  fneError: string | null;
  fneErrorKind: string | null;
  fneAttempts: number;
  fneNextRetryAt: string | Date | null;
}

const MAX_QR_BYTES = 300_000;

export function FnePanel({
  invoice,
  mode,
  canManage,
  timeZone,
  onChanged,
}: {
  invoice: FneInvoice;
  mode: string;
  canManage: boolean;
  timeZone: string;
  onChanged: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const retry = trpc.fne.retry.useMutation({ onSuccess: onChanged });
  if (invoice.status === "DRAFT" || invoice.fneStatus === "NOT_REQUIRED") return null;
  const certified = invoice.fneStatus === "CERTIFIED" || invoice.fneStatus === "MANUAL";
  const failed = invoice.fneStatus === "FAILED";
  const tone = certified
    ? "border-status-ok bg-status-ok-bg"
    : failed
      ? "border-status-bad bg-status-bad-bg"
      : "border-status-warn bg-status-warn-bg";

  return (
    <section
      aria-label={t("fneBlock.title")}
      data-testid="fne-panel"
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${tone}`}
    >
      <h2 className="font-semibold">{t("fneBlock.title")}</h2>
      {certified ? (
        <>
          <p>
            {t("fneBlock.number")} :{" "}
            <span className="break-all font-mono font-semibold" data-testid="fne-number">
              {invoice.fneNumber}
            </span>
          </p>
          <p className="text-muted">
            {t(`fneBlock.source.${invoice.fneStatus}`)}
            {invoice.fneCertifiedAt
              ? ` · ${t("fneBlock.certifiedAt")} ${formatDay(invoice.fneCertifiedAt, timeZone)}`
              : ""}
          </p>
        </>
      ) : (
        <>
          <p role={failed ? "alert" : undefined}>
            {failed ? "✕" : "⚠"} {failed ? t("fneBlock.failed") : t("fnePending")}
          </p>
          {invoice.fneError && <p className="break-words">{invoice.fneError}</p>}
          {failed && invoice.fneErrorKind === "rejected" && <p>{t("fneBlock.rejected")}</p>}
          {mode !== "api" && <p className="text-muted">{t("fneBlock.manualHint")}</p>}
          {mode === "api" && invoice.fneAttempts > 0 && (
            <p className="text-muted">
              {t("fneBlock.attempts", { count: invoice.fneAttempts })}
              {invoice.fneNextRetryAt && invoice.fneErrorKind !== "rejected"
                ? ` · ${t("fneBlock.nextRetry", { date: formatDateTime(invoice.fneNextRetryAt, timeZone) })}`
                : ""}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setManualOpen(true)}>{t("fneBlock.setManual")}</Button>
              {mode === "api" && (
                <Button
                  variant="secondary"
                  loading={retry.isPending}
                  onClick={() => retry.mutate({ invoiceId: invoice.id })}
                >
                  {t("fneBlock.retry")}
                </Button>
              )}
            </div>
          )}
          {retry.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {retry.error.message}
            </p>
          )}
        </>
      )}
      {manualOpen && (
        <ManualFneModal
          invoiceId={invoice.id}
          onClose={() => setManualOpen(false)}
          onDone={() => {
            setManualOpen(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function ManualFneModal({
  invoiceId,
  onClose,
  onDone,
}: {
  invoiceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fneNumber, setFneNumber] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [qrImage, setQrImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const save = trpc.fne.setManual.useMutation({ onSuccess: onDone });

  function onFile(file: File | undefined) {
    setFileError(null);
    setQrImage(null);
    if (!file) return;
    if (file.size > MAX_QR_BYTES) {
      setFileError(t("fneManual.qrImageTooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setQrImage({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <Modal
      open
      title={t("fneManual.title")}
      onClose={onClose}
      footer={
        <Button
          loading={save.isPending}
          disabled={fneNumber.trim().length < 3 || (!qrCode.trim() && !qrImage)}
          onClick={() =>
            save.mutate({
              invoiceId,
              fneNumber,
              qrCode: qrCode.trim() || undefined,
              qrImage: qrImage?.dataUrl,
            })
          }
        >
          {t("fneManual.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Input
          label={t("fneManual.number")}
          value={fneNumber}
          onChange={(e) => setFneNumber(e.target.value)}
          className="min-h-11"
          autoComplete="off"
        />
        <Input
          label={t("fneManual.qrCode")}
          value={qrCode}
          onChange={(e) => setQrCode(e.target.value)}
          className="min-h-11"
          autoComplete="off"
        />
        <label className="flex flex-col gap-1">
          {t("fneManual.qrImage")}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="min-h-11 max-w-full"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {qrImage && <p>{t("fneManual.qrImageSelected", { name: qrImage.name })}</p>}
        {fileError && (
          <p role="alert" className="text-status-bad">
            ⚠ {fileError}
          </p>
        )}
        {save.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {save.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
