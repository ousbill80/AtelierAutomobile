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
  const answered = checklist.filter((i) => results[i.key]).length;
  const complete = answered === checklist.length;
  const hasNok = Object.values(results).includes("NOK");
  const returnOldParts = Boolean((o.checkIn as { returnOldParts?: boolean }).returnOldParts);
  const mechanics = new Set(o.lines.map((l) => l.assignedTo?.id).filter(Boolean));
  const soloMechanic =
    mechanics.size === 1 && me.data?.membership?.id && mechanics.has(me.data.membership.id);
  const kmStartN = kmStart ? Number(kmStart) : null;
  const kmEndN = kmEnd ? Number(kmEnd) : null;
  const kmInverted = kmStartN != null && kmEndN != null && kmEndN < kmStartN;
  const hasRoadTestItem = checklist.some((item) => item.key === "road_test");
  const roadTest =
    kmStartN != null &&
    kmEndN != null &&
    !kmInverted &&
    (!hasRoadTestItem || results.road_test === "OK")
      ? { kmStart: kmStartN, kmEnd: kmEndN }
      : undefined;
  const payload = {
    id,
    checklist: checklist.map((i) => ({ key: i.key, result: results[i.key] ?? "NA" })),
    roadTest,
    comment: comment || undefined,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <Link
        href={`/ordres/${id}`}
        className="inline-flex min-h-11 items-center text-sm text-accent"
      >
        ← {o.number}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("qc.title", { number: o.number })}</h1>
        <span className="text-sm font-medium text-muted">
          {t("qc.progress", { done: answered, total: checklist.length })}
        </span>
      </div>
      {(returnOldParts || soloMechanic) && (
        <div className="flex flex-col gap-1 rounded-md border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn">
          {returnOldParts && <p>⚠ {t("qc.returnOldParts")}</p>}
          {soloMechanic && <p>⚠ {t("qc.sameMechanicWarning")}</p>}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() =>
            setResults(Object.fromEntries(checklist.map((item) => [item.key, "OK" as const])))
          }
        >
          {t("qc.markAllOk")}
        </Button>
      </div>
      <section className="flex flex-col gap-2" aria-label={t("qc.checklist")}>
        {checklist.map((item, index) => {
          const selected = results[item.key];
          const emphasize = item.key === "old_parts" && returnOldParts && selected !== "OK";
          return (
            <div
              key={item.key}
              className={`flex flex-col gap-3 rounded-lg border bg-surface p-3 ${
                selected === "NOK"
                  ? "border-status-bad"
                  : selected === "OK"
                    ? "border-status-ok"
                    : emphasize
                      ? "border-status-warn"
                      : "border-border"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium">
                  <span className="mr-2 text-muted">{index + 1}.</span>
                  {item.label}
                </span>
                <div
                  className="grid grid-cols-3 gap-2 sm:w-[28rem]"
                  role="radiogroup"
                  aria-label={item.label}
                >
                  {(["OK", "NOK", "NA"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={selected === r}
                      onClick={() => setResults((prev) => ({ ...prev, [item.key]: r }))}
                      className={`min-h-11 rounded-md border-2 px-2 text-sm font-semibold ${
                        selected === r
                          ? r === "OK"
                            ? "border-status-ok bg-status-ok-bg text-status-ok"
                            : r === "NOK"
                              ? "border-status-bad bg-status-bad-bg text-status-bad"
                              : "border-foreground bg-surface-2"
                          : "border-border bg-surface text-muted"
                      }`}
                    >
                      {r === "OK" ? "✓ " : r === "NOK" ? "✗ " : ""}
                      {t(`qc.results.${r}`)}
                    </button>
                  ))}
                </div>
              </div>
              {emphasize && <p className="text-sm text-status-warn">{t("qc.oldPartsHint")}</p>}
              {item.key === "road_test" && selected === "OK" && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">{t("qc.roadTestHint")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
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
                  </div>
                  {kmInverted && <p className="text-sm text-status-bad">{t("qc.kmOrder")}</p>}
                </div>
              )}
            </div>
          );
        })}
      </section>
      {!hasRoadTestItem && (
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
          {kmInverted && <p className="text-sm text-status-bad sm:col-span-2">{t("qc.kmOrder")}</p>}
        </fieldset>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span>{hasNok ? t("qc.rejectReason") : t("qc.comment")}</span>
        <Textarea
          value={comment}
          placeholder={hasNok ? undefined : t("qc.commentPlaceholder")}
          onChange={(e) => setComment(e.target.value)}
        />
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
      <div className="sticky bottom-[var(--bottom-nav-offset)] z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg/95 py-3">
        <span className="text-sm text-muted">
          {!complete ? t("qc.needAll") : hasNok ? t("qc.nokBlocks") : t("qc.ready")}
        </span>
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
    </div>
  );
}
