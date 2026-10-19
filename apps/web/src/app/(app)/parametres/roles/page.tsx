"use client";

import { Button, CheckboxRow, PageHead } from "@atelieros/ui";
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
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th />
              {matrix.data.roles.map((r) => (
                <th key={r.role}>{t(`common.roles.${r.role}`)}</th>
              ))}
            </tr>
            <tr>
              <th />
              {matrix.data.roles.map((r) => (
                <th key={r.role}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!r.isCustomized}
                    onClick={() => resetDefaults.mutate({ role: r.role })}
                  >
                    {t("settings.roles.resetDefaults")}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.data.permissions.map((permission) => (
              <tr key={permission}>
                <td>{t(`permissions.${permission}`)}</td>
                {matrix.data!.roles.map((r) => (
                  <td key={r.role}>
                    <CheckboxRow
                      label=""
                      checked={r.permissions.includes(permission)}
                      onChange={(e) => toggle(r.role, permission, r.permissions, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
