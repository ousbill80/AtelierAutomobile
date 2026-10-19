"use client";

// M04 US-M04-11 / RG-M04-13 — contrôle qualité : check-list OK / NOK / N/A, essai routier,
// commentaire ; valider (→ READY) ou refuser avec motif et lignes à reprendre (→ IN_PROGRESS).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/repair-orders/i18n";

type QcResult = "OK" | "NOK" | "NA";

export function QcView({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const order = trpc.repairOrder.get.useQuery({ id });
  const [results, setResults] = useState<Record<string, QcResult>>({});
  const [kmStart, setKmStart] = useState("");
  const [kmEnd, setKmEnd] = useState("");
  const [comment, setComment] = useState("");
  const [rejectLines, setRejectLines] = useState<string[]>([]);
  const qc = trpc.repairOrder.qc.useMutation({
    onSuccess: () => {
      void utils.repairOrder.get.invalidate({ id });
      router.push(`/ordres/${id}`);
    },
  });

  if (order.isLoading) return <ListSkeleton rows={4} />;
  if (order.isError || !order.data) return <ErrorBox onRetry={() => order.refetch()} />;
  const o = order.data;
  const checklist = o.settings.qcChecklist;
  const complete = checklist.every((i) => results[i.key]);
  const hasNok = Object.values(results).includes("NOK");
  const mechanics = new Set(o.lines.map((l) => l.assignedTo?.id).filter(Boolean));
  const soloMechanic =
    mechanics.size === 1 && me.data?.membership?.id && mechanics.has(me.data.membership.id);
  const roadTest =
    kmStart && kmEnd ? { kmStart: Number(kmStart), kmEnd: Number(kmEnd) } : undefined;
  const payload = {
    id,
    checklist: checklist.map((i) => ({ key: i.key, result: results[i.key] ?? "NA" })),
    roadTest,
    comment: comment || undefined,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <Link href={`/ordres/${id}`} className="text-sm text-accent">
        ← {o.number}
      </Link>
      <h1 className="text-xl font-semibold">{t("qc.title", { number: o.number })}</h1>
      {Boolean((o.checkIn as { returnOldParts?: boolean }).returnOldParts) && (
        <p className="rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          ⚠ {t("qc.returnOldParts")}
        </p>
      )}
      {soloMechanic && <p className="text-sm text-status-warn">⚠ {t("qc.sameMechanicWarning")}</p>}
      <section className="flex flex-col gap-2" aria-label={t("qc.checklist")}>
        {checklist.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-sm font-medium">{item.label}</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={item.label}>
              {(["OK", "NOK", "NA"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={results[item.key] === r}
                  onClick={() => setResults((prev) => ({ ...prev, [item.key]: r }))}
                  className={`min-h-11 rounded-md border-2 px-3 text-sm font-semibold ${
                    results[item.key] === r
                      ? r === "OK"
                        ? "border-status-ok bg-status-ok-bg text-status-ok"
                        : r === "NOK"
                          ? "border-status-bad bg-status-bad-bg text-status-bad"
                          : "border-border bg-surface-2"
                      : "border-border bg-surface"
                  }`}
                >
                  {r === "OK" ? "✓ " : r === "NOK" ? "✗ " : ""}
                  {t(`qc.results.${r}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t("qc.roadTest")}</legend>
        <Input
          label={t("qc.kmStart")}
          inputMode="numeric"
          value={kmStart}
          onChange={(e) => setKmStart(e.target.value.replace(/\D/g, ""))}
        />
        <Input
          label={t("qc.kmEnd")}
          inputMode="numeric"
          value={kmEnd}
          onChange={(e) => setKmEnd(e.target.value.replace(/\D/g, ""))}
        />
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span>{hasNok ? t("qc.rejectReason") : t("qc.comment")}</span>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {hasNok && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">{t("qc.rejectLines")}</legend>
          {o.lines
            .filter((l) => l.status === "DONE")
            .map((l) => (
              <label key={l.id} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={rejectLines.includes(l.id)}
                  onChange={(e) =>
                    setRejectLines((prev) =>
                      e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id),
                    )
                  }
                />
                {l.description}
              </label>
            ))}
        </fieldset>
      )}
      {qc.error && <ErrorBox message={qc.error.message} />}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!complete || hasNok}
          loading={qc.isPending}
          onClick={() => qc.mutate(payload)}
        >
          ✓ {t("qc.validate")}
        </Button>
        <Button
          variant="danger"
          disabled={!comment.trim()}
          loading={qc.isPending}
          onClick={() => qc.mutate({ ...payload, reject: true, rejectLineIds: rejectLines })}
        >
          ✗ {t("qc.reject")}
        </Button>
      </div>
    </div>
  );
}
