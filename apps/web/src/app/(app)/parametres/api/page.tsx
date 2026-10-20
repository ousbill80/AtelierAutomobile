"use client";

// M13 §7 — /parametres/api : clés de l'API publique (création avec droits, clé montrée une seule
// fois, révocation, journal d'accès) et webhooks sortants (URL https, événements, secret montré
// une seule fois, test, rotation, désactivation, livraisons et relivraison).
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, CheckboxRow, Input, PageHead, Select, StatusBadge } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

type Outputs = inferRouterOutputs<AppRouter>;
type KeyRow = Outputs["apiKeys"]["list"]["keys"][number];
type Endpoint = Outputs["webhooks"]["list"]["endpoints"][number];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ApiSettingsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHead
        title={t("apiSettings.title")}
        description={t("apiSettings.description")}
        actions={
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary min-h-11"
          >
            {t("apiSettings.docs")}
          </a>
        }
      />
      <ApiKeysSection />
      <WebhooksSection />
    </div>
  );
}

function OnceSecret({ title, hint, value }: { title: string; hint: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-status-warn bg-surface-2 p-3 text-sm"
    >
      <p className="font-semibold">{title}</p>
      <p>{hint}</p>
      <code className="break-all rounded bg-surface p-2" data-testid="once-secret">
        {value}
      </code>
      <div>
        <Button size="sm" variant="secondary" onClick={async () => setCopied(await copy(value))}>
          {copied ? t("apiSettings.keys.copied") : t("apiSettings.keys.copy")}
        </Button>
      </div>
    </div>
  );
}

function ApiKeysSection() {
  const utils = trpc.useUtils();
  const list = trpc.apiKeys.list.useQuery();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [scopes, setScopes] = useState<string[]>(["customers:read"]);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const create = trpc.apiKeys.create.useMutation({
    onSuccess: () => {
      setCreating(false);
      setName("");
      void utils.apiKeys.list.invalidate();
    },
  });
  const revoke = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => void utils.apiKeys.list.invalidate(),
  });

  if (list.isError) {
    return <ErrorBox onRetry={() => list.refetch()} message={t("apiSettings.loadError")} />;
  }
  if (!list.data) return <ListSkeleton />;

  return (
    <section className="flex flex-col gap-3" aria-label={t("apiSettings.keys.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{t("apiSettings.keys.title")}</h3>
        {!creating && (
          <Button onClick={() => setCreating(true)}>{t("apiSettings.keys.new")}</Button>
        )}
      </div>
      {create.data && (
        <OnceSecret
          title={t("apiSettings.keys.createdTitle")}
          hint={t("apiSettings.keys.copyOnce")}
          value={create.data.key}
        />
      )}
      {creating && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Input
            label={t("apiSettings.keys.name")}
            placeholder={t("apiSettings.keys.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            {t("apiSettings.keys.environment")}
            <Select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as "live" | "test")}
            >
              <option value="live">{t("apiSettings.keys.environments.live")}</option>
              <option value="test">{t("apiSettings.keys.environments.test")}</option>
            </Select>
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t("apiSettings.keys.scopes")}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {list.data.scopes.map((s) => (
                <CheckboxRow
                  key={s}
                  label={s}
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                  }
                />
              ))}
            </div>
          </fieldset>
          {create.error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {create.error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={create.isPending}
              disabled={name.trim().length < 2 || scopes.length === 0}
              onClick={() => create.mutate({ name, environment, scopes, siteIds: [] })}
            >
              {t("apiSettings.keys.create")}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {list.data.keys.length === 0 ? (
        <p className="text-sm text-muted">{t("apiSettings.keys.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.keys.map((k) => (
            <ApiKeyItem
              key={k.id}
              item={k}
              revoking={revoke.isPending && revoke.variables?.id === k.id}
              onRevoke={() => revoke.mutate({ id: k.id })}
              showLogs={logsFor === k.id}
              onToggleLogs={() => setLogsFor(logsFor === k.id ? null : k.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApiKeyItem({
  item,
  revoking,
  onRevoke,
  showLogs,
  onToggleLogs,
}: {
  item: KeyRow;
  revoking: boolean;
  onRevoke: () => void;
  showLogs: boolean;
  onToggleLogs: () => void;
}) {
  const logs = trpc.apiKeys.logs.useQuery({ id: item.id }, { enabled: showLogs });
  const state = item.revokedAt ? "revoked" : item.expired ? "expired" : "active";
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm"
      data-testid="api-key"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{item.name}</span>
          <code className="text-xs">{item.prefix}</code>
          <StatusBadge
            tone={state === "active" ? "ok" : "off"}
            label={
              state === "active"
                ? `✓ ${t("apiSettings.keys.active")}`
                : state === "revoked"
                  ? `✕ ${t("apiSettings.keys.revoked")}`
                  : `⌛ ${t("apiSettings.keys.expired")}`
            }
          />
          <span className="text-xs text-muted">
            {t(`apiSettings.keys.environments.${item.environment}`)}
          </span>
        </span>
        <span className="text-xs text-muted">
          {item.lastUsedAt
            ? t("apiSettings.keys.lastUsed", { date: formatDateTime(item.lastUsedAt) })
            : t("apiSettings.keys.neverUsed")}
          {" · "}
          {t("apiSettings.keys.requests", { count: item.requests24h })}
        </span>
      </div>
      <p className="break-words text-xs text-muted">{item.scopes.join(" · ")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onToggleLogs}>
          {t("apiSettings.keys.logs")}
        </Button>
        {state === "active" && (
          <Button size="sm" variant="ghost" loading={revoking} onClick={onRevoke}>
            {t("apiSettings.keys.revoke")}
          </Button>
        )}
      </div>
      {showLogs && logs.data && (
        <ul className="flex flex-col gap-1 text-xs" data-testid="api-logs">
          {logs.data.length === 0 && <li className="text-muted">{t("apiSettings.keys.noLogs")}</li>}
          {logs.data.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-2">
              <span className="font-mono">{l.method}</span>
              <span className="min-w-0 break-all font-mono">{l.path}</span>
              <span className={l.status < 400 ? "text-status-ok" : "text-status-bad"}>
                {l.status}
              </span>
              <span className="text-muted">
                {formatDateTime(l.createdAt)} · {l.durationMs} ms
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function WebhooksSection() {
  const utils = trpc.useUtils();
  const list = trpc.webhooks.list.useQuery();
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("https://");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(["invoice.issued", "payment.received"]);
  const [secret, setSecret] = useState<string | null>(null);
  const create = trpc.webhooks.create.useMutation({
    onSuccess: (out) => {
      setSecret(out.secret);
      setCreating(false);
      void utils.webhooks.list.invalidate();
    },
  });

  if (list.isError) {
    return <ErrorBox onRetry={() => list.refetch()} message={t("apiSettings.loadError")} />;
  }
  if (!list.data) return <ListSkeleton />;

  return (
    <section className="flex flex-col gap-3" aria-label={t("apiSettings.webhooks.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{t("apiSettings.webhooks.title")}</h3>
        {!creating && (
          <Button onClick={() => setCreating(true)}>{t("apiSettings.webhooks.new")}</Button>
        )}
      </div>
      {secret && (
        <OnceSecret
          title={t("apiSettings.webhooks.secretTitle")}
          hint={t("apiSettings.webhooks.secretOnce")}
          value={secret}
        />
      )}
      {creating && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Input
            label={t("apiSettings.webhooks.url")}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            label={t("apiSettings.webhooks.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t("apiSettings.webhooks.events")}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {list.data.events.map((ev) => (
                <CheckboxRow
                  key={ev}
                  label={ev}
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                  }
                />
              ))}
            </div>
          </fieldset>
          {create.error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {create.error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={create.isPending}
              disabled={events.length === 0 || url.length < 9}
              onClick={() => create.mutate({ url, events, description: description || null })}
            >
              {t("apiSettings.webhooks.create")}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {list.data.endpoints.length === 0 ? (
        <p className="text-sm text-muted">{t("apiSettings.webhooks.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.endpoints.map((e) => (
            <WebhookItem key={e.id} endpoint={e} onSecret={setSecret} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WebhookItem({
  endpoint,
  onSecret,
}: {
  endpoint: Endpoint;
  onSecret: (secret: string) => void;
}) {
  const utils = trpc.useUtils();
  const deliveries = trpc.webhooks.deliveries.useQuery({ id: endpoint.id, limit: 10 });
  const refresh = () => {
    void utils.webhooks.list.invalidate();
    void utils.webhooks.deliveries.invalidate({ id: endpoint.id });
  };
  const test = trpc.webhooks.test.useMutation({ onSuccess: refresh });
  const update = trpc.webhooks.update.useMutation({
    onSuccess: (out) => {
      if (out.secret) onSecret(out.secret);
      refresh();
    },
  });
  const remove = trpc.webhooks.delete.useMutation({ onSuccess: refresh });
  const redeliver = trpc.webhooks.redeliver.useMutation({ onSuccess: refresh });
  const error = test.error ?? update.error ?? remove.error ?? redeliver.error;
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm"
      data-testid="webhook"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-all font-mono">{endpoint.url}</span>
        <StatusBadge
          tone={endpoint.is_active ? "ok" : "off"}
          label={
            endpoint.is_active
              ? `✓ ${t("apiSettings.webhooks.active")}`
              : `✕ ${t("apiSettings.webhooks.inactive")}`
          }
        />
      </div>
      {endpoint.description && <p className="text-muted">{endpoint.description}</p>}
      <p className="break-words text-xs text-muted">{endpoint.events.join(" · ")}</p>
      {endpoint.consecutive_failures > 0 && (
        <p className="text-xs text-status-warn">
          ⚠ {t("apiSettings.webhooks.failures", { count: endpoint.consecutive_failures })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={test.isPending}
          onClick={() => test.mutate({ id: endpoint.id })}
        >
          {t("apiSettings.webhooks.test")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={update.isPending && update.variables?.rotateSecret === true}
          onClick={() => update.mutate({ id: endpoint.id, rotateSecret: true })}
          title={t("apiSettings.webhooks.rotateHint")}
        >
          {t("apiSettings.webhooks.rotate")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => update.mutate({ id: endpoint.id, isActive: !endpoint.is_active })}
        >
          {endpoint.is_active
            ? t("apiSettings.webhooks.disable")
            : t("apiSettings.webhooks.enable")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={remove.isPending}
          onClick={() => remove.mutate({ id: endpoint.id })}
        >
          {t("apiSettings.webhooks.delete")}
        </Button>
      </div>
      {test.data && (
        <p role="status" className="text-xs">
          {t("apiSettings.webhooks.testResult", {
            status: `${t(`apiSettings.webhooks.status.${test.data.status}`)}${test.data.response_code ? ` (HTTP ${test.data.response_code})` : ""}`,
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-bad">
          ⚠ {error.message}
        </p>
      )}
      <h4 className="text-xs font-semibold">{t("apiSettings.webhooks.deliveries")}</h4>
      {deliveries.data && deliveries.data.length === 0 && (
        <p className="text-xs text-muted">{t("apiSettings.webhooks.noDeliveries")}</p>
      )}
      <ul className="flex flex-col gap-1 text-xs" data-testid="webhook-deliveries">
        {deliveries.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={d.status === "succeeded" ? "ok" : d.status === "failed" ? "bad" : "warn"}
              label={`${d.status === "succeeded" ? "✓" : d.status === "failed" ? "✕" : "⏳"} ${t(`apiSettings.webhooks.status.${d.status}`)}`}
            />
            <span className="font-mono">{d.event_type}</span>
            <span className="text-muted">
              {t("apiSettings.webhooks.attempt", { count: d.attempt })}
              {d.response_code ? ` · HTTP ${d.response_code}` : ""}
              {d.next_attempt_at && d.status === "pending"
                ? ` · ${t("apiSettings.webhooks.nextAttempt", { date: formatDateTime(d.next_attempt_at) })}`
                : ""}
            </span>
            {d.status !== "succeeded" && (
              <Button
                size="sm"
                variant="ghost"
                loading={redeliver.isPending && redeliver.variables?.id === d.id}
                onClick={() => redeliver.mutate({ id: d.id })}
              >
                {t("apiSettings.webhooks.redeliver")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
