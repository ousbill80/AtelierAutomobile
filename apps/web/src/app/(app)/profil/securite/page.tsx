"use client";

import { Button, Card, EmptyState, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

export default function ProfileSecurityPage() {
  const utils = trpc.useUtils();
  const sessions = trpc.session.list.useQuery();
  const revoke = trpc.session.revoke.useMutation({
    onSuccess() {
      utils.session.list.invalidate();
    },
  });

  return (
    <>
      <PageHead title={t("profile.security.title")} />
      <Card title={t("profile.security.sessionsTitle")}>
        {sessions.isLoading ? (
          <p>{t("common.loading")}</p>
        ) : sessions.data && sessions.data.length > 0 ? (
          <div className="stack">
            {sessions.data.map((session) => (
              <div key={session.id} className="list-row">
                <div>
                  <strong>{session.userAgent ?? session.device ?? "—"}</strong>
                  <p>{session.ip ?? "—"}</p>
                  {session.current ? (
                    <span className="hint">{t("profile.security.currentSession")}</span>
                  ) : null}
                </div>
                {!session.current ? (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={revoke.isPending}
                    onClick={() => revoke.mutate({ sessionId: session.id })}
                  >
                    {t("profile.security.revokeSession")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t("profile.security.noSessions")} />
        )}
      </Card>
      <Card title={t("profile.security.trustedDevicesTitle")}>
        <EmptyState title={t("profile.security.noTrustedDevices")} />
      </Card>
    </>
  );
}
