"use client";

// M13 §7 — `/import/agent` (partie 2, étape 6.4) : code d'appairage, état des agents locaux
// (En ligne / Hors ligne depuis…), version, dernière synchro, révocation (RG-M13-28).
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCircle2, Clock, Laptop, Loader2, WifiOff } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { EmptyState } from "@atelieros/ui/src/empty-state";
import { StatusBadge, type StatusTone } from "@atelieros/ui/src/status-badge";
import type { AppRouter } from "@/server/routers/_app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/client";
import { formatDateTime } from "../sources/shared";

type Agent = inferRouterOutputs<AppRouter>["syncAgents"]["list"][number];

function agentBadge(agent: Agent): { key: string; tone: StatusTone; icon: typeof Clock } {
  if (agent.status === "PAIRING") {
    return agent.pairingExpired
      ? { key: "EXPIRED", tone: "off", icon: Ban }
      : { key: "PAIRING", tone: "warn", icon: Clock };
  }
  if (agent.status === "ONLINE") return { key: "ONLINE", tone: "ok", icon: CheckCircle2 };
  if (agent.status === "OFFLINE") return { key: "OFFLINE", tone: "bad", icon: WifiOff };
  return { key: "REVOKED", tone: "off", icon: Ban };
}

export default function AgentPage() {
  const utils = trpc.useUtils();
  const query = trpc.syncAgents.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = trpc.syncAgents.createPairingCode.useMutation({
    onSuccess: () => utils.syncAgents.list.invalidate(),
    onError: (e) => setError(e.message),
  });
  const revoke = trpc.syncAgents.revoke.useMutation({
    onSuccess: () => utils.syncAgents.list.invalidate(),
    onError: (e) => setError(e.message),
  });
  const pairing = create.data;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <Link
        href="/import/sources"
        className="flex min-h-11 items-center gap-1 text-sm text-muted hover:underline"
      >
        <ArrowLeft className="size-4" />
        {t("import.agent.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("import.agent.title")}</h1>
        <p className="text-sm text-muted">{t("import.agent.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.agent.pairTitle")}</CardTitle>
          <CardDescription>{t("import.agent.pairDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              create.mutate({ name });
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-foreground">
              {t("import.agent.name")}
              <Input
                value={name}
                placeholder={t("import.agent.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("import.agent.generate")}
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-status-bad">
              {error}
            </p>
          )}
          {pairing && (
            <div
              className="flex flex-col items-start gap-2 rounded-md border border-border bg-surface-2 p-4"
              role="status"
            >
              <span className="text-xs text-muted">{t("import.agent.codeLabel")}</span>
              <span
                data-testid="pairing-code"
                className="font-mono text-3xl font-bold tracking-[0.3em] text-foreground"
              >
                {pairing.code}
              </span>
              <span className="text-xs text-muted">
                {t("import.agent.codeExpires", {
                  time: new Intl.DateTimeFormat("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(pairing.expiresAt)),
                })}
              </span>
              <Button asChild variant="outline">
                <Link href={`/import/sources/${pairing.dataSourceId}`}>
                  {t("import.agent.configureQueries")}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.agent.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={Laptop}
              title={t("import.agent.error")}
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  {t("import.agent.retry")}
                </Button>
              }
            />
          ) : !query.data || query.data.length === 0 ? (
            <EmptyState icon={Laptop} title={t("import.agent.empty")} />
          ) : (
            <ul className="divide-y divide-border">
              {query.data.map((agent) => {
                const badge = agentBadge(agent);
                return (
                  <li
                    key={agent.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {agent.name}
                        {agent.hostname ? ` · ${agent.hostname}` : ""}
                      </span>
                      <StatusBadge tone={badge.tone} icon={badge.icon}>
                        {t(`import.agent.status.${badge.key}`)}
                      </StatusBadge>
                      <span className="text-xs text-muted">
                        {agent.lastSeenAt
                          ? t("import.agent.lastSeen", { date: formatDateTime(agent.lastSeenAt) })
                          : t("import.agent.neverSeen")}
                        {agent.version
                          ? ` · ${t("import.agent.version", { version: agent.version })}`
                          : ""}
                        {agent.lastSyncAt
                          ? ` · ${t("import.agent.lastSync", { date: formatDateTime(agent.lastSyncAt) })}`
                          : ""}
                      </span>
                      {agent.lastError && (
                        <span className="text-xs text-status-bad">{agent.lastError}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {agent.dataSourceId && agent.status !== "REVOKED" && (
                        <Button asChild variant="outline">
                          <Link href={`/import/sources/${agent.dataSourceId}`}>
                            {t("import.agent.configureQueries")}
                          </Link>
                        </Button>
                      )}
                      {agent.status !== "REVOKED" && (
                        <Button
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate({ id: agent.id })}
                        >
                          {t("import.agent.revoke")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
