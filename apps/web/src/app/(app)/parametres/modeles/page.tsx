"use client";

// RG-M11 §7.3 : éditeur de modèles avec aperçu et compteur SMS (version minimale).
// L'aperçu est rendu côté serveur avec des données de démonstration (template.preview).
import { useEffect, useState } from "react";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
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
  const upsert = trpc.template.upsert.useMutation({
    onSuccess: () => {
      setSaved(true);
      return utils.template.list.invalidate();
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
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex w-full flex-col gap-2 md:w-72">
        <h1 className="text-xl font-semibold">{t("settings.templatesPage.title")}</h1>
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
            className={`min-h-11 rounded-md border border-border px-3 text-left text-sm ${selectedId === template.id ? "bg-accent text-accent-foreground" : ""}`}
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
                  {t("settings.templatesPage.previewError", { message: preview.error.message })}
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
  );
}
