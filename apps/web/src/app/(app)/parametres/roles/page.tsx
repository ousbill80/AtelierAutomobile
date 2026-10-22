"use client";

// M01 — /parametres/roles : matrice permissions × rôles (le propriétaire a toujours tout).
// Tableau défilant dans son cadre (jamais la page), première colonne figée, en-têtes compacts.
import { RotateCcw } from "lucide-react";
import { PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

export default function RolesPage() {
  const utils = trpc.useUtils();
  const matrix = trpc.role.getMatrix.useQuery();

  const updatePermissions = trpc.role.updatePermissions.useMutation({
    onSuccess() {
      utils.role.getMatrix.invalidate();
    },
  });
  const resetDefaults = trpc.role.resetDefaults.useMutation({
    onSuccess() {
      utils.role.getMatrix.invalidate();
    },
  });

  if (matrix.isLoading || !matrix.data) {
    return <p>{t("common.loading")}</p>;
  }

  type RoleKey = (typeof matrix.data.roles)[number]["role"];

  function toggle(role: RoleKey, permission: string, current: readonly string[], checked: boolean) {
    const next = checked ? [...current, permission] : current.filter((p) => p !== permission);
    updatePermissions.mutate({ role, permissions: next });
  }

  return (
    <>
      <PageHead title={t("settings.roles.title")} description={t("settings.roles.description")} />
      <p className="hint">{t("settings.roles.ownerColumnNote")}</p>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-56 border-b border-border bg-bg px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                {t("settings.roles.permission")}
              </th>
              {matrix.data.roles.map((r) => {
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
                        onClick={() => resetDefaults.mutate({ role: r.role })}
                        className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-surface-2"
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
            {matrix.data.permissions.map((permission) => (
              <tr key={permission} className="group">
                <td className="sticky left-0 z-10 border-b border-border bg-surface px-4 py-2.5 group-hover:bg-bg">
                  {t(`permissions.${permission}`)}
                </td>
                {matrix.data!.roles.map((r) => {
                  const label = `${t(`permissions.${permission}`)} — ${t(`common.roles.${r.role}`)}`;
                  return (
                    <td
                      key={r.role}
                      className="border-b border-border px-2 text-center group-hover:bg-bg"
                    >
                      <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--accent)]"
                          aria-label={label}
                          checked={r.permissions.includes(permission)}
                          onChange={(e) =>
                            toggle(r.role, permission, r.permissions, e.target.checked)
                          }
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
