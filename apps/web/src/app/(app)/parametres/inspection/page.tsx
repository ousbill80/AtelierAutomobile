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

function fromText(text: string) {
  return text
    .split("\n")
    .map((line) => line.split(";").map((p) => p.trim()))
    .filter((parts) => parts[0] && parts[1])
    .map(([category, label, unit]) => ({
      category: category!,
      label: label!,
      ...(unit ? { measurementUnit: unit } : {}),
    }));
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
  const done = () => {
    setEditing(null);
    void utils.inspectionTemplate.list.invalidate();
  };
  const create = trpc.inspectionTemplate.create.useMutation({ onSuccess: done });
  const update = trpc.inspectionTemplate.update.useMutation({ onSuccess: done });
  const duplicate = trpc.inspectionTemplate.duplicate.useMutation({ onSuccess: done });
  const archive = trpc.inspectionTemplate.archive.useMutation({ onSuccess: done });
  const error = create.error ?? update.error ?? duplicate.error ?? archive.error;

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
                  items: fromText(editing.text),
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
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => archive.mutate({ id: tpl.id, archived: tpl.isActive })}
              >
                {tpl.isActive ? t("templates.archive") : t("templates.restore")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
