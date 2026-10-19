"use client";

// M08 §7 `/factures/exports` — période, journal, format ; contrôle d'équilibre ; CSV téléchargé.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/billing/i18n";

function download(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function monthStart(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today.slice(0, 8)}01`;
}

export default function ExportsPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [journal, setJournal] = useState<"ALL" | "VT" | "EN" | "CA">("ALL");
  const [format, setFormat] = useState<"syscohada_csv" | "sales_csv">("syscohada_csv");
  const m = trpc.accounting.export.useMutation({
    onSuccess: (res) => download(res.fileName, res.csv),
  });
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-4">
      <Link href="/factures" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("exports.title")}</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label={t("exports.from")}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label={t("exports.to")}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          {t("exports.journal")}
          <Select value={journal} onChange={(e) => setJournal(e.target.value as typeof journal)}>
            {(["ALL", "VT", "EN", "CA"] as const).map((j) => (
              <option key={j} value={j}>
                {t(`exports.journals.${j}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("exports.format")}
          <Select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            {(["syscohada_csv", "sales_csv"] as const).map((f) => (
              <option key={f} value={f}>
                {t(`exports.formats.${f}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {m.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {m.error.message}
        </p>
      )}
      <Button loading={m.isPending} onClick={() => m.mutate({ from, to, journal, format })}>
        {t("exports.submit")}
      </Button>
      {m.data && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
          role="status"
        >
          {format === "syscohada_csv" && (
            <p className="text-status-ok">
              ✓{" "}
              {t("exports.balanced", {
                debit: formatFCFA(m.data.debit),
                credit: formatFCFA(m.data.credit),
                count: m.data.count,
              })}
            </p>
          )}
          <Button variant="secondary" onClick={() => download(m.data.fileName, m.data.csv)}>
            {t("exports.download")}
          </Button>
        </div>
      )}
    </div>
  );
}
