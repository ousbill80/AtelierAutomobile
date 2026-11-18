"use client";

// RG-M11 §7.3 : éditeur de modèles avec aperçu et compteur SMS (version minimale).
// L'aperçu est rendu côté serveur avec des données de démonstration (template.preview).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Modal, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";

const CHANNEL_LABELS: Record<Channel, string> = {
  WHATSAPP: t("settings.templatesPage.channels.WHATSAPP"),
  SMS: t("settings.templatesPage.channels.SMS"),
  EMAIL: t("settings.templatesPage.channels.EMAIL"),
};

/** Attend que la saisie se calme avant de recalculer l'aperçu. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function TemplatesPage() {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canManage = (me.data?.permissions ?? []).includes("template:manage");
  const { data: templates, isLoading, isError, refetch } = trpc.template.list.useQuery({});
  const [saved, setSaved] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const upsert = trpc.template.upsert.useMutation({
    onSuccess: () => {
      setSaved(true);
      return utils.template.list.invalidate();
    },
  });

  const bulkToggle = trpc.template.bulkToggle.useMutation({
    onSuccess: ({ isActive }) => {
      setBulkFeedback({
        ok: true,
        msg: isActive
          ? t("settings.templatesPage.bulkActivated")
          : t("settings.templatesPage.bulkDeactivated"),
      });
      return utils.template.list.invalidate();
    },
    onError: (err) => {
      setBulkFeedback({
        ok: false,
        msg: t("settings.templatesPage.bulkError", { message: err.message }),
      });
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const previewBody = useDebounced(body);

  const selected = templates?.find((tpl) => tpl.id === selectedId) ?? null;
  const preview = trpc.template.preview.useQuery(
    { channel: selected?.channel ?? "SMS", body: previewBody },
    { enabled: canManage && Boolean(selected) && previewBody.trim().length > 0, retry: false },
  );

  function select(templateId: string) {
    const template = templates?.find((tpl) => tpl.id === templateId);
    setSelectedId(templateId);
    setBody(template?.body ?? "");
    setSaved(false);
    upsert.reset();
    setBulkFeedback(null);
  }

  const hasAutoSendNote = templates?.some((tpl) => tpl.name.includes("(inactif par défaut)"));

  return (
    <>
      {/* Confirmation désactivation en masse */}
      <Modal
        open={confirmDeactivate}
        title={t("settings.templatesPage.deactivateConfirmTitle")}
        onClose={() => setConfirmDeactivate(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDeactivate(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => {
                setConfirmDeactivate(false);
                setBulkFeedback(null);
                bulkToggle.mutate({ isActive: false });
              }}
            >
              {t("settings.templatesPage.deactivateConfirmCta")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">{t("settings.templatesPage.deactivateConfirmBody")}</p>
      </Modal>

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex w-full flex-col gap-2 md:w-72">
          {/* Titre + actions en masse */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">{t("settings.templatesPage.title")}</h1>
            {canManage && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bulkToggle.isPending}
                  onClick={() => {
                    setBulkFeedback(null);
                    bulkToggle.mutate({ isActive: true });
                  }}
                >
                  {t("settings.templatesPage.activateAll")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bulkToggle.isPending}
                  onClick={() => setConfirmDeactivate(true)}
                >
                  {t("settings.templatesPage.deactivateAll")}
                </Button>
              </div>
            )}
          </div>

          {/* Feedback bulk */}
          {bulkFeedback && (
            <StatusBadge tone={bulkFeedback.ok ? "ok" : "bad"}>{bulkFeedback.msg}</StatusBadge>
          )}

          {/* Note autoSend : clarifie que "(inactif par défaut)" ≠ MessageTemplate.isActive */}
          {hasAutoSendNote && (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
              ℹ️ {t("settings.templatesPage.autoSendNote")}{" "}
              <Link
                href="/parametres/relances"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t("settings.templatesPage.autoSendNoteLink")}
              </Link>
              .
            </p>
          )}

          {isLoading && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <span className="sr-only">{t("settings.templatesPage.loading")}</span>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-md border border-border bg-surface-2"
                />
              ))}
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
              <p className="text-sm text-status-bad">{t("settings.templatesPage.loadError")}</p>
              <Button variant="secondary" onClick={() => refetch()}>
                {t("settings.templatesPage.retry")}
              </Button>
            </div>
          )}
          {templates && templates.length === 0 && (
            <EmptyState
              title={t("settings.templatesPage.emptyTitle")}
              description={t("settings.templatesPage.emptyHint")}
            />
          )}
          {templates?.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => select(template.id)}
              aria-pressed={selectedId === template.id}
              className={`min-h-11 rounded-md border border-border px-3 text-left text-sm ${selectedId === template.id ? "bg-accent text-accent-foreground" : ""} ${!template.isActive ? "opacity-50" : ""}`}
            >
              {template.name}{" "}
              <span className="opacity-70">
                ({CHANNEL_LABELS[template.channel as Channel] ?? template.channel})
              </span>
            </button>
          ))}
        </div>

        {templates && templates.length > 0 && !selected && (
          <p className="flex-1 text-sm text-muted">{t("settings.templatesPage.selectHint")}</p>
        )}

        {selected && (
          <div className="flex flex-1 flex-col gap-3">
            <h2 className="font-semibold">{selected.name}</h2>
            {me.data && !canManage && (
              <p className="rounded-md bg-surface-2 p-3 text-sm text-muted">
                {t("settings.templatesPage.readOnly")}
              </p>
            )}
            <label htmlFor="template-body" className="text-sm font-medium">
              {t("settings.templatesPage.bodyLabel")}
            </label>
            <textarea
              id="template-body"
              className="min-h-32 rounded-md border border-border p-3 text-sm disabled:opacity-70"
              value={body}
              disabled={!canManage}
              onChange={(e) => {
                setBody(e.target.value);
                setSaved(false);
              }}
            />

            {canManage && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t("settings.templatesPage.previewTitle")}</h3>
                {preview.isFetching && !preview.data && (
                  <p className="text-sm text-muted">{t("settings.templatesPage.previewLoading")}</p>
                )}
                {preview.error && (
                  <p role="alert" className="text-sm text-status-bad">
                    {t("settings.templatesPage.previewError", {
                      message: preview.error.message,
                    })}
                  </p>
                )}
                {preview.data?.sms && (
                  <p className="text-sm text-muted">
                    {t("settings.templatesPage.smsCounter", {
                      chars: preview.data.sms.chars,
                      segments: preview.data.sms.segments,
                      encoding: preview.data.sms.encoding,
                    })}
                  </p>
                )}
                {preview.data?.warnings.map((warning, index) => (
                  <StatusBadge key={index} tone="warn">
                    {warning}
                  </StatusBadge>
                ))}
                {preview.data?.rendered && (
                  <div className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm">
                    {preview.data.rendered}
                  </div>
                )}
              </div>
            )}

            {canManage && (
              <div className="flex flex-col items-start gap-2">
                <Button
                  disabled={upsert.isPending || body.trim().length === 0}
                  onClick={() =>
                    upsert.mutate({
                      id: selected.id,
                      key: selected.key,
                      name: selected.name,
                      channel: selected.channel,
                      subject: selected.subject,
                      body,
                      isActive: selected.isActive,
                    })
                  }
                >
                  {upsert.isPending
                    ? t("settings.templatesPage.saving")
                    : t("settings.templatesPage.save")}
                </Button>
                {saved && !upsert.isPending && (
                  <StatusBadge tone="ok">{t("settings.templatesPage.saved")}</StatusBadge>
                )}
                {upsert.error && (
                  <p role="alert" className="text-sm text-status-bad">
                    {t("settings.templatesPage.saveError", { message: upsert.error.message })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
