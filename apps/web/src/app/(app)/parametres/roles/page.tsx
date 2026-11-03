"use client";

// M01 — /parametres/roles : matrice permissions × rôles (le propriétaire a toujours tout).
// Tableau défilant dans son cadre (jamais la page), première colonne figée, en-têtes compacts.
// Permissions groupées par module (préfixe avant « : »), recherche, mise à jour optimiste :
// chaque clic part de l'état du cache (jamais d'une copie périmée), la colonne du rôle est
// verrouillée pendant l'enregistrement et l'état est restauré en cas d'échec.
import { useMemo, useRef, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, Input, PageHead } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type MatrixRole = inferRouterOutputs<AppRouter>["role"]["getMatrix"]["roles"][number]["role"];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function moduleLabel(prefix: string): string {
  try {
    return t(`settings.roles.modules.${prefix}`);
  } catch {
    return t("settings.roles.modules.other");
  }
}

function MatrixSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="h-11 animate-pulse rounded-lg bg-surface-2" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function RolesPage() {
  const utils = trpc.useUtils();
  const matrix = trpc.role.getMatrix.useQuery();
  const [query, setQuery] = useState("");
  const [pendingRoles, setPendingRoles] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);

  function markPending(role: string, pending: boolean) {
    setPendingRoles((current) => {
      const next = new Set(current);
      if (pending) next.add(role);
      else next.delete(role);
      return next;
    });
  }

  const updatePermissions = trpc.role.updatePermissions.useMutation({
    async onMutate(variables) {
      inFlight.current += 1;
      markPending(variables.role, true);
      setNotice(null);
      setError(null);
      await utils.role.getMatrix.cancel();
      const previous = utils.role.getMatrix
        .getData()
        ?.roles.find((r) => r.role === variables.role)?.permissions;
      utils.role.getMatrix.setData(undefined, (data) =>
        data
          ? {
              ...data,
              roles: data.roles.map((r) =>
                r.role === variables.role
                  ? { ...r, permissions: variables.permissions, isCustomized: true }
                  : r,
              ),
            }
          : data,
      );
      return { previous };
    },
    onSuccess() {
      setNotice(t("settings.roles.saved"));
    },
    onError(err, variables, context) {
      if (context?.previous) {
        const previous = context.previous;
        utils.role.getMatrix.setData(undefined, (data) =>
          data
            ? {
                ...data,
                roles: data.roles.map((r) =>
                  r.role === variables.role ? { ...r, permissions: previous } : r,
                ),
              }
            : data,
        );
      }
      setError(t("settings.roles.saveError", { message: err.message }));
    },
    onSettled(_data, _err, variables) {
      markPending(variables.role, false);
      inFlight.current -= 1;
      // On ne recharge qu'une fois toutes les écritures terminées, pour ne pas écraser
      // l'état optimiste d'un autre rôle encore en cours d'enregistrement.
      if (inFlight.current === 0) void utils.role.getMatrix.invalidate();
    },
  });

  const resetDefaults = trpc.role.resetDefaults.useMutation({
    onMutate(variables) {
      markPending(variables.role, true);
      setNotice(null);
      setError(null);
    },
    onSuccess(result) {
      setNotice(t("settings.roles.resetDone", { role: t(`common.roles.${result.role}`) }));
    },
    onError(err) {
      setError(t("settings.roles.saveError", { message: err.message }));
    },
    onSettled(_data, _err, variables) {
      markPending(variables.role, false);
      void utils.role.getMatrix.invalidate();
    },
  });

  const groups = useMemo(() => {
    const permissions = matrix.data?.permissions ?? [];
    const needle = normalize(query.trim());
    const byModule = new Map<string, string[]>();
    for (const permission of permissions) {
      const prefix = permission.split(":")[0] ?? permission;
      if (needle) {
        const haystack = normalize(
          `${t(`permissions.${permission}`)} ${moduleLabel(prefix)} ${permission}`,
        );
        if (!haystack.includes(needle)) continue;
      }
      const list = byModule.get(prefix) ?? [];
      list.push(permission);
      byModule.set(prefix, list);
    }
    return [...byModule.entries()].map(([prefix, items]) => ({
      prefix,
      label: moduleLabel(prefix),
      items,
    }));
  }, [matrix.data?.permissions, query]);

  function toggle(role: MatrixRole, permission: string, checked: boolean) {
    // Lecture dans le cache au moment du clic : jamais depuis la ligne rendue (périmée).
    const current =
      utils.role.getMatrix.getData()?.roles.find((r) => r.role === role)?.permissions ?? [];
    const next = checked
      ? [...new Set([...current, permission])]
      : current.filter((p) => p !== permission);
    updatePermissions.mutate({ role, permissions: next });
  }

  const header = (
    <>
      <PageHead title={t("settings.roles.title")} description={t("settings.roles.description")} />
      <p className="hint">{t("settings.roles.ownerColumnNote")}</p>
    </>
  );

  if (matrix.isError) {
    return (
      <>
        {header}
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">{t("settings.roles.loadError")}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => matrix.refetch()}>
            {t("settings.roles.retry")}
          </Button>
        </div>
      </>
    );
  }

  if (!matrix.data) {
    return (
      <>
        {header}
        <MatrixSkeleton />
      </>
    );
  }

  const roles = matrix.data.roles;

  return (
    <>
      {header}
      <div className="mb-3 flex max-w-md items-center gap-2">
        <Search size={16} aria-hidden className="shrink-0 text-muted" />
        <Input
          type="search"
          className="min-h-11"
          aria-label={t("settings.roles.searchLabel")}
          placeholder={t("settings.roles.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div aria-live="polite">
        {notice ? (
          <p role="status" className="mb-2 text-sm text-status-ok">
            ✓ {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-2 text-sm text-status-bad">
            ✕ {error}
          </p>
        ) : null}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-56 border-b border-border bg-bg px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                {t("settings.roles.permission")}
              </th>
              {roles.map((r) => {
                const role = t(`common.roles.${r.role}`);
                return (
                  <th
                    key={r.role}
                    className="sticky top-0 z-20 border-b border-border bg-bg px-2 py-2 text-center align-top"
                  >
                    <span className="block text-xs font-semibold text-foreground uppercase">
                      {role}
                    </span>
                    {r.isCustomized ? (
                      <button
                        type="button"
                        title={t("settings.roles.resetTitle", { role })}
                        aria-label={t("settings.roles.resetTitle", { role })}
                        disabled={pendingRoles.has(r.role)}
                        onClick={() => resetDefaults.mutate({ role: r.role })}
                        className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-surface-2 disabled:opacity-50"
                      >
                        <RotateCcw size={12} aria-hidden /> {t("settings.roles.resetShort")}
                      </button>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={roles.length + 1} className="px-4 py-6 text-center text-muted">
                  {t("settings.roles.noResults", { query: query.trim() })}
                </td>
              </tr>
            ) : null}
            {groups.map((group) => (
              <GroupRows
                key={group.prefix}
                label={group.label}
                permissions={group.items}
                roles={roles}
                pendingRoles={pendingRoles}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroupRows({
  label,
  permissions,
  roles,
  pendingRoles,
  onToggle,
}: {
  label: string;
  permissions: string[];
  roles: readonly { role: MatrixRole; permissions: readonly string[] }[];
  pendingRoles: ReadonlySet<string>;
  onToggle: (role: MatrixRole, permission: string, checked: boolean) => void;
}) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={roles.length + 1}
          className="sticky left-0 border-b border-border bg-surface-2 px-4 py-2 text-left text-xs font-semibold text-foreground uppercase"
        >
          {label}
        </th>
      </tr>
      {permissions.map((permission) => (
        <tr key={permission} className="group">
          <td className="sticky left-0 z-10 border-b border-border bg-surface px-4 py-2.5 group-hover:bg-bg">
            {t(`permissions.${permission}`)}
          </td>
          {roles.map((r) => {
            const pending = pendingRoles.has(r.role);
            const ariaLabel = `${t(`permissions.${permission}`)} — ${t(`common.roles.${r.role}`)}`;
            return (
              <td
                key={r.role}
                className="border-b border-border px-2 text-center group-hover:bg-bg"
              >
                <label
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center ${pending ? "cursor-wait opacity-60" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent)]"
                    aria-label={ariaLabel}
                    checked={r.permissions.includes(permission)}
                    disabled={pending}
                    onChange={(e) => onToggle(r.role, permission, e.target.checked)}
                  />
                </label>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
