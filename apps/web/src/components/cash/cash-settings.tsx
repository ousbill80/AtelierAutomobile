"use client";

// RG-M08-29/30 — réglages de caisse (Paramètres › Paiements) : seuil d'alerte d'écart, seuil de
// validation des dépenses, une caisse par site, catégories de dépenses. Écriture réservée à
// `settings:billing` (propriétaire par défaut).
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, CheckboxRow, Input, MoneyInput } from "@atelieros/ui";
import { tc } from "@/components/billing/i18n";
import { trpc } from "@/trpc/react";

export function CashSettingsCard() {
  const q = trpc.cash.settings.useQuery();
  const me = trpc.me.get.useQuery();
  if (!q.data)
    return <div className="h-64 animate-pulse rounded-lg bg-surface-2" aria-busy="true" />;
  const canEdit = (me.data?.permissions ?? []).includes("settings:billing");
  return <CashSettingsForm key={JSON.stringify(q.data)} initial={q.data} canEdit={canEdit} />;
}

function CashSettingsForm({
  initial,
  canEdit,
}: {
  initial: {
    varianceAlert: number;
    expenseApproval: number;
    oneSessionPerSite: boolean;
    expenseCategories: string[];
  };
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [varianceAlert, setVarianceAlert] = useState<number | null>(initial.varianceAlert);
  const [expenseApproval, setExpenseApproval] = useState<number | null>(initial.expenseApproval);
  const [oneSessionPerSite, setOneSessionPerSite] = useState(initial.oneSessionPerSite);
  const [categories, setCategories] = useState(initial.expenseCategories);
  const [draft, setDraft] = useState("");
  const save = trpc.cash.updateSettings.useMutation({
    onSuccess: () => void utils.cash.invalidate(),
  });

  const addCategory = () => {
    const name = draft.trim();
    if (!name || categories.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    setCategories([...categories, name]);
    setDraft("");
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <h3 className="font-semibold">{tc("settings.title")}</h3>
        <p className="text-sm text-muted">{tc("settings.description")}</p>
      </div>
      <fieldset disabled={!canEdit} className="flex flex-col gap-1 disabled:opacity-80">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <MoneyInput
            label={tc("settings.varianceAlert")}
            value={varianceAlert}
            onChange={setVarianceAlert}
            hint={tc("settings.varianceAlertHint")}
          />
          <MoneyInput
            label={tc("settings.expenseApproval")}
            value={expenseApproval}
            onChange={setExpenseApproval}
            hint={tc("settings.expenseApprovalHint")}
          />
        </div>
        <CheckboxRow
          label={tc("settings.oneSessionPerSite")}
          checked={oneSessionPerSite}
          onChange={(e) => setOneSessionPerSite(e.target.checked)}
        />
        <p className="-mt-1 mb-4 text-xs text-muted">{tc("settings.oneSessionPerSiteHint")}</p>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">{tc("settings.categories")}</span>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li
                key={c}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-bg pr-1 pl-3 text-sm"
              >
                {c}
                {canEdit && categories.length > 1 && (
                  <button
                    type="button"
                    aria-label={tc("settings.removeCategory", { name: c })}
                    onClick={() => setCategories(categories.filter((x) => x !== c))}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex flex-wrap items-start gap-2 [&_.field]:mb-0">
              <div className="min-w-0 flex-1 basis-56">
                <Input
                  aria-label={tc("settings.categoryPlaceholder")}
                  placeholder={tc("settings.categoryPlaceholder")}
                  value={draft}
                  maxLength={60}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCategory();
                    }
                  }}
                />
              </div>
              <Button variant="secondary" className="min-h-12" onClick={addCategory}>
                <Plus size={16} aria-hidden /> {tc("settings.addCategory")}
              </Button>
            </div>
          )}
        </div>
      </fieldset>
      {save.error && (
        <p role="alert" className="text-sm text-status-bad">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p className="text-sm text-status-ok">{tc("settings.saved")}</p>}
      {canEdit ? (
        <div>
          <Button
            className="min-h-11"
            loading={save.isPending}
            disabled={varianceAlert === null || expenseApproval === null}
            onClick={() =>
              save.mutate({
                varianceAlert: varianceAlert ?? 0,
                expenseApproval: expenseApproval ?? 0,
                oneSessionPerSite,
                expenseCategories: categories,
              })
            }
          >
            {tc("settings.save")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">{tc("settings.readOnly")}</p>
      )}
    </section>
  );
}
