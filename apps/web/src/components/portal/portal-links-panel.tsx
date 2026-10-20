"use client";

// M14 §7 « Côté back-office » — bloc « Lien client » d'une ressource : créer (copier le lien et
// son alias SMS), envoyer au client (WhatsApp, repli SMS), voir la dernière ouverture et le nombre
// d'ouvertures, révoquer avec motif. Le lien complet n'est affiché qu'à sa création : seul son
// hash est stocké (RG-M14-01).
import { useState } from "react";
import { Button, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";

type Scope = "QUOTE" | "INVOICE" | "REPAIR_ORDER" | "APPOINTMENT" | "VEHICLE" | "SURVEY";

const STATE_TONE: Record<string, StatusTone> = { ACTIVE: "ok", EXPIRED: "off", REVOKED: "bad" };

export function PortalLinksPanel({
  scope,
  targetId,
  canWrite,
}: {
  scope: Scope;
  targetId: string;
  canWrite: boolean;
}) {
  const utils = trpc.useUtils();
  const list = trpc.portalLinks.list.useQuery({ scope, targetId }, { retry: false });
  const [created, setCreated] = useState<{ url: string; shortUrl: string | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => utils.portalLinks.list.invalidate({ scope, targetId });
  const create = trpc.portalLinks.create.useMutation({
    onSuccess: (link) => {
      setCreated(link);
      setFlash(null);
      refresh();
    },
  });
  const send = trpc.portalLinks.send.useMutation({
    onSuccess: (link) => {
      setCreated(link);
      setFlash(t("portal.links.sent"));
      refresh();
    },
  });
  const revoke = trpc.portalLinks.revoke.useMutation({
    onSuccess: () => {
      setRevoking(null);
      setReason("");
      refresh();
    },
  });
  const error = create.error ?? send.error ?? revoke.error;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
      data-testid={`portal-links-${scope}`}
    >
      <h3 className="font-semibold">
        {t("portal.links.title")} — {t(`portal.links.scopes.${scope}`)}
      </h3>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            loading={create.isPending}
            onClick={() => create.mutate({ scope, targetId })}
          >
            🔗 {t("portal.links.create")}
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            loading={send.isPending}
            onClick={() => send.mutate({ scope, targetId })}
          >
            💬 {t("portal.links.send")}
          </Button>
        </div>
      )}
      {flash && (
        <p role="status" className="text-status-ok">
          ✓ {flash}
        </p>
      )}
      {created && (
        <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-2">
          <span>{t("portal.links.newLink")}</span>
          <code className="break-all" data-testid="portal-link-url">
            {created.url}
          </code>
          {created.shortUrl && (
            <span className="break-all">
              {t("portal.links.shortUrl", { url: created.shortUrl })}
            </span>
          )}
          <Button
            variant="secondary"
            className="min-h-11 self-start"
            onClick={() => {
              void navigator.clipboard?.writeText(created.url).then(
                () => setFlash(t("portal.links.copied")),
                () => undefined,
              );
            }}
          >
            📋 {t("portal.links.copy")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-status-bad">
          {error.message}
        </p>
      )}
      {list.isLoading ? (
        <div className="h-10 animate-pulse rounded bg-surface-2" aria-busy="true" />
      ) : list.isError ? (
        <p className="text-status-bad">{t("portal.links.error")}</p>
      ) : list.data && list.data.length === 0 ? (
        <p className="text-muted">{t("portal.links.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data?.map((link) => (
            <li key={link.id} className="flex flex-col gap-1 border-t border-border pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={STATE_TONE[link.state] ?? "off"}
                  label={t(`portal.links.states.${link.state}`)}
                />
                <span className="text-muted">{t(`portal.links.origins.${link.origin}`)}</span>
                <span>{formatDateTime(link.createdAt)}</span>
              </div>
              <span>
                {link.openCount > 0
                  ? `${t("portal.links.opens", { count: link.openCount })} · ${t("portal.links.lastOpened", { date: formatDateTime(link.lastOpenedAt) })}`
                  : t("portal.links.neverOpened")}
              </span>
              {link.state === "ACTIVE" && (
                <span className="text-muted">
                  {t("portal.links.expires", { date: formatDateTime(link.expiresAt) })}
                </span>
              )}
              {link.revokeReason && <span className="text-muted">{link.revokeReason}</span>}
              {canWrite && link.state === "ACTIVE" && revoking !== link.id && (
                <Button
                  variant="ghost"
                  className="min-h-11 self-start"
                  onClick={() => setRevoking(link.id)}
                >
                  {t("portal.links.revoke")}
                </Button>
              )}
              {revoking === link.id && (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    revoke.mutate({ id: link.id, reason });
                  }}
                >
                  <label className="flex flex-col gap-1">
                    <span>{t("portal.links.revokeReason")}</span>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={3}
                      required
                      className="min-h-11 rounded-md border border-border bg-surface px-2"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" className="min-h-11" loading={revoke.isPending}>
                      {t("portal.links.revokeConfirm")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => setRevoking(null)}
                    >
                      {t("portal.links.cancel")}
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
