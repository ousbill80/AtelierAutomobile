"use client";

// M04 §7 — /parametres/inspection : modèles d'inspection (liste, éditeur texte « Catégorie ;
// Libellé ; unité », dupliquer, archiver, modèle par défaut).
import { useState } from "react";
import { Button, EmptyState, Input, PageHead, StatusBadge, Textarea } from "@atelieros/ui";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/repair-orders/i18n";
import type { RouterOutputs } from "@/components/repair-orders/types";
import { trpc } from "@/trpc/react";

type Template = RouterOutputs["inspectionTemplate"]["list"][number];

function toText(items: Template["items"]): string {
  return items
    .map((i) => [i.category, i.label, i.measurementUnit].filter(Boolean).join(" ; "))
    .join("\n");
}

/**
 * « Catégorie ; Libellé ; unité » par ligne. Une ligne sans « ; » (ou sans catégorie) n'est
 * plus ignorée : elle devient un point de la catégorie par défaut, signalé sous l'éditeur.
 */
function fromText(text: string) {
  const fallback = t("templates.defaultCategory");
  const items: { category: string; label: string; measurementUnit?: string }[] = [];
  const defaulted: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(";").map((p) => p.trim());
    if (!parts.some(Boolean)) continue;
    let category = parts[0] ?? "";
    let label = parts[1] ?? "";
    let unit = parts[2] ?? "";
    if (!label) {
      // « Libellé » seul, ou « Libellé ; » : pas de catégorie exploitable.
      label = category || parts.slice(2).find(Boolean) || "";
      category = "";
      unit = "";
    }
    if (!label) continue;
    if (!category) {
      category = fallback;
      defaulted.push(label);
    }
    items.push({ category, label, ...(unit ? { measurementUnit: unit } : {}) });
  }
  return { items, defaulted };
}

export default function InspectionTemplatesPage() {
  const utils = trpc.useUtils();
  const list = trpc.inspectionTemplate.list.useQuery({ includeArchived: true });
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    text: string;
    isDefault: boolean;
  } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Template | null>(null);
  const refresh = () => void utils.inspectionTemplate.list.invalidate();
  const done = () => {
    setEditing(null);
    refresh();
  };
  const create = trpc.inspectionTemplate.create.useMutation({ onSuccess: done });
  const update = trpc.inspectionTemplate.update.useMutation({ onSuccess: done });
  // Dupliquer ne ferme pas un éditeur ouvert (modifications en cours) ; sinon la copie s'ouvre
  // directement pour être renommée.
  const duplicate = trpc.inspectionTemplate.duplicate.useMutation({
    onSuccess: (copy) => {
      refresh();
      setEditing(
        (current) =>
          current ?? {
            id: copy.id,
            name: copy.name,
            text: toText(copy.items as unknown as Template["items"]),
            isDefault: copy.isDefault,
          },
      );
    },
  });
  const archive = trpc.inspectionTemplate.archive.useMutation({
    onSuccess: () => {
      setConfirmArchive(null);
      refresh();
    },
  });
  const error = create.error ?? update.error ?? duplicate.error ?? archive.error;
  const parsed = editing ? fromText(editing.text) : null;
  // Modèle qui deviendra le défaut si on archive le défaut actuel (même règle que le serveur).
  const nextDefault = (tpl: Template) =>
    list.data
      ?.filter((o) => o.isActive && o.id !== tpl.id)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
  const onArchive = (tpl: Template) => {
    if (tpl.isActive && tpl.isDefault) setConfirmArchive(tpl);
    else archive.mutate({ id: tpl.id, archived: tpl.isActive });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title={t("templates.title")}
        description={t("templates.description")}
        actions={
          <Button onClick={() => setEditing({ name: "", text: "", isDefault: false })}>
            {t("templates.new")}
          </Button>
        }
      />
      {error && <ErrorBox message={error.message} />}
      {confirmArchive && (
        <section
          role="alertdialog"
          aria-labelledby="archive-default-title"
          className="flex flex-col gap-2 rounded-lg border border-status-warn bg-surface p-3"
        >
          <p id="archive-default-title" className="text-sm font-medium">
            ⚠{" "}
            {nextDefault(confirmArchive)
              ? t("templates.archiveDefaultWarning", {
                  name: confirmArchive.name,
                  next: nextDefault(confirmArchive)!.name,
                })
              : t("templates.archiveDefaultWarningLast", { name: confirmArchive.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              loading={archive.isPending}
              onClick={() => archive.mutate({ id: confirmArchive.id, archived: true })}
            >
              {t("templates.archiveConfirm")}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setConfirmArchive(null)}>
              {t("cancel")}
            </Button>
          </div>
        </section>
      )}
      {editing && (
        <section className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-3">
          <Input
            label={t("templates.name")}
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("templates.items")}</span>
            <Textarea
              rows={12}
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </label>
          {parsed && parsed.defaulted.length > 0 && (
            <p role="status" className="text-sm text-status-warn">
              ⚠{" "}
              {t("templates.defaultedLines", {
                category: t("templates.defaultCategory"),
                labels: parsed.defaulted.join(", "),
              })}
            </p>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={editing.isDefault}
              onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
            />
            {t("templates.setDefault")}
          </label>
          <div className="flex gap-2">
            <Button
              loading={create.isPending || update.isPending}
              onClick={() => {
                const payload = {
                  name: editing.name,
                  items: fromText(editing.text).items,
                  isDefault: editing.isDefault,
                };
                if (editing.id) update.mutate({ id: editing.id, ...payload });
                else create.mutate(payload);
              }}
            >
              {t("save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
          </div>
        </section>
      )}
      {list.isLoading && <ListSkeleton />}
      {list.isError && <ErrorBox onRetry={() => list.refetch()} />}
      {list.data?.length === 0 && <EmptyState title={t("templates.empty")} />}
      <ul className="flex flex-col gap-2">
        {list.data?.map((tpl) => (
          <li
            key={tpl.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{tpl.name}</span>
              <span className="text-sm text-muted">
                {t("templates.pointsCount", { count: tpl.items.length })}
              </span>
              {tpl.isDefault && <StatusBadge tone="ok" label={t("templates.default")} />}
              {!tpl.isActive && <StatusBadge tone="off" label={t("templates.archived")} />}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() =>
                  setEditing({
                    id: tpl.id,
                    name: tpl.name,
                    text: toText(tpl.items),
                    isDefault: tpl.isDefault,
                  })
                }
              >
                {t("templates.edit")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => duplicate.mutate({ id: tpl.id })}
              >
                {t("templates.duplicate")}
              </Button>
              <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onArchive(tpl)}>
                {tpl.isActive ? t("templates.archive") : t("templates.restore")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
