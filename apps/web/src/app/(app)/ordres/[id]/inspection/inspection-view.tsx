"use client";

// M04 US-M04-06 — inspection multipoints plein écran (tablette d'abord) : catégorie par
// catégorie, boutons OK / À surveiller / Urgent / Non vérifié de 56 px, mesure, commentaire,
// photo, recommandations, « Tout OK », clôture.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Input, PhotoCapture, type PhotoStatus } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { InspectionResultBadge } from "@/components/repair-orders/badges";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/repair-orders/i18n";
import type { RouterOutputs } from "@/components/repair-orders/types";

const RESULTS = ["OK", "WATCH", "URGENT", "NOT_CHECKED"] as const;
type Result = (typeof RESULTS)[number];
type InspectionData = RouterOutputs["inspection"]["get"];
type Item = InspectionData["items"][number];

const RESULT_STYLE: Record<Result, string> = {
  OK: "border-status-ok bg-status-ok-bg text-status-ok",
  WATCH: "border-status-warn bg-status-warn-bg text-status-warn",
  URGENT: "border-status-bad bg-status-bad-bg text-status-bad",
  NOT_CHECKED: "border-border bg-surface-2 text-muted",
};
const RESULT_ICON: Record<Result, string> = { OK: "✓", WATCH: "!", URGENT: "⚠", NOT_CHECKED: "–" };

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => SpeechRecognitionLike) | null;
}

export function InspectionView({ repairOrderId }: { repairOrderId: string }) {
  const router = useRouter();
  const order = trpc.repairOrder.get.useQuery({ id: repairOrderId });
  const start = trpc.inspection.start.useMutation();
  const [startedId, setInspectionId] = useState<string | null>(null);
  const existing =
    order.data?.inspections.find((i) => !i.completedAt) ?? order.data?.inspections[0];
  const inspectionId = startedId ?? existing?.id ?? null;

  if (order.isLoading) return <ListSkeleton rows={5} />;
  if (order.isError || !order.data) return <ErrorBox onRetry={() => order.refetch()} />;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link href={`/ordres/${repairOrderId}`} className="text-sm text-accent">
        ← {order.data.number}
      </Link>
      <h1 className="text-xl font-semibold">
        {t("inspection.title", { number: order.data.number })}
      </h1>
      {inspectionId ? (
        <InspectionEditor
          inspectionId={inspectionId}
          repairOrderId={repairOrderId}
          onCompleted={() => router.push(`/ordres/${repairOrderId}`)}
        />
      ) : (
        <EmptyState
          title={t("inspection.none")}
          action={
            <Button
              loading={start.isPending}
              onClick={async () => {
                const res = await start.mutateAsync({ repairOrderId });
                setInspectionId(res.id);
              }}
            >
              {t("inspection.start")}
            </Button>
          }
        />
      )}
      {start.error && <ErrorBox message={start.error.message} />}
    </div>
  );
}

function InspectionEditor({
  inspectionId,
  repairOrderId,
  onCompleted,
}: {
  inspectionId: string;
  repairOrderId: string;
  onCompleted: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.inspection.get.useQuery({ inspectionId });
  const refresh = () => void utils.inspection.get.invalidate({ inspectionId });
  const bulkOk = trpc.inspection.bulkOk.useMutation({ onSuccess: refresh });
  const complete = trpc.inspection.complete.useMutation({
    onSuccess: () => {
      void utils.repairOrder.get.invalidate({ id: repairOrderId });
      onCompleted();
    },
  });
  if (query.isLoading) return <ListSkeleton rows={5} />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;
  const data = query.data;
  const readOnly = Boolean(data.completedAt);
  const categories = [...new Set(data.items.map((i) => i.category))];

  return (
    <div className="flex flex-col gap-4 pb-24">
      <p className="text-sm text-muted">
        {data.template?.name} · {t("inspection.summary", { ...data.summary })}
      </p>
      {categories.map((category) => {
        const items = data.items.filter((i) => i.category === category);
        const result =
          data.categories.find((c) => c.category === category)?.result ?? "NOT_CHECKED";
        return (
          <section
            key={category}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
            aria-label={category}
          >
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                {category} <InspectionResultBadge result={result} />
              </h2>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  loading={bulkOk.isPending}
                  onClick={() => bulkOk.mutate({ inspectionId, category })}
                >
                  ✓ {t("inspection.allOk")}
                </Button>
              )}
            </header>
            {items.map((item) => (
              <ItemEditor
                key={item.id}
                item={item}
                repairOrderId={repairOrderId}
                readOnly={readOnly}
                onSaved={refresh}
              />
            ))}
          </section>
        );
      })}
      {data.summary.withoutRecommendation > 0 && (
        <p className="text-sm text-status-warn">
          ⚠ {t("inspection.withoutRecommendation", { count: data.summary.withoutRecommendation })}
        </p>
      )}
      {complete.error && <ErrorBox message={complete.error.message} />}
      {!readOnly && (
        <div className="sticky bottom-0 border-t border-border bg-bg py-3">
          <Button
            block
            loading={complete.isPending}
            onClick={() => complete.mutate({ inspectionId })}
          >
            {t("inspection.complete")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ItemEditor({
  item,
  repairOrderId,
  readOnly,
  onSaved,
}: {
  item: Item;
  repairOrderId: string;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const save = trpc.inspection.saveItem.useMutation({ onSuccess: onSaved });
  const upload = trpc.repairOrder.uploadAttachment.useMutation();
  const [measurement, setMeasurement] = useState(item.measurement ?? "");
  const [comment, setComment] = useState(item.comment ?? "");
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>(
    item.photoUrls.length ? "done" : "empty",
  );
  const [preview, setPreview] = useState<string | null>(item.photoUrls[0] ?? null);
  const [labor, setLabor] = useState<string[]>(item.recommendedLaborIds);
  const [parts, setParts] = useState<string[]>(item.recommendedProductIds);
  const [listening, setListening] = useState(false);
  const photoIds = item.photoUrls.map((u) => u.split("/").pop()!);
  const flagged = item.result === "URGENT" || item.result === "WATCH";

  const persist = (patch: Partial<Parameters<typeof save.mutate>[0]>) =>
    save.mutate({
      itemId: item.id,
      result: item.result,
      measurement: measurement || null,
      comment: comment || null,
      recommendedLaborIds: labor,
      recommendedProductIds: parts,
      ...patch,
    });

  const dictateComment = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      if (!text) return;
      setComment((prev) => {
        const next = [prev, text].filter(Boolean).join(" ");
        persist({ comment: next || null });
        return next;
      });
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2" data-testid="inspection-item">
      <span className="font-medium">{item.label}</span>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="radiogroup"
        aria-label={item.label}
      >
        {RESULTS.map((result) => (
          <button
            key={result}
            type="button"
            role="radio"
            aria-checked={item.result === result}
            disabled={readOnly}
            onClick={() => persist({ result })}
            className={`min-h-14 rounded-md border-2 px-2 text-sm font-semibold ${
              item.result === result ? RESULT_STYLE[result] : "border-border bg-surface"
            }`}
          >
            {RESULT_ICON[result]} {t(`inspection.results.${result}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          label={t("inspection.measurement")}
          value={measurement}
          disabled={readOnly}
          onChange={(e) => setMeasurement(e.target.value)}
          onBlur={() => persist({})}
        />
        <div className="flex flex-col gap-1">
          <Input
            label={t("inspection.comment")}
            value={comment}
            disabled={readOnly}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => persist({})}
          />
          {!readOnly && speechRecognitionCtor() && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 self-start"
              disabled={listening}
              onClick={dictateComment}
            >
              {listening ? t("inspection.dictating") : t("inspection.dictate")}
            </Button>
          )}
        </div>
      </div>
      {!readOnly && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PhotoCapture
              label={t("inspection.photo")}
              previewUrl={preview}
              status={photoStatus}
              takeLabel={t("reception.takePhoto")}
              retakeLabel={t("reception.retake")}
              errorLabel={t("reception.photoFailed")}
              uploadingLabel={t("reception.photoUploading")}
              onCapture={async (image) => {
                setPreview(image.dataUrl);
                setPhotoStatus("uploading");
                try {
                  const res = await upload.mutateAsync({
                    repairOrderId,
                    kind: "photo_inspection",
                    mimeType: image.mimeType,
                    dataBase64: image.base64,
                  });
                  setPhotoStatus("done");
                  persist({ photoAttachmentIds: [...photoIds, res.attachmentId] });
                } catch {
                  setPhotoStatus("error");
                }
              }}
            />
          </div>
          {flagged && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={item.shareWithCustomer}
                  onChange={(e) => persist({ shareWithCustomer: e.target.checked })}
                />
                {t("inspection.share")}
              </label>
              <Recommendations
                labor={labor}
                parts={parts}
                onChange={(nextLabor, nextParts) => {
                  setLabor(nextLabor);
                  setParts(nextParts);
                  persist({ recommendedLaborIds: nextLabor, recommendedProductIds: nextParts });
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Recommendations({
  labor,
  parts,
  onChange,
}: {
  labor: string[];
  parts: string[];
  onChange: (labor: string[], parts: string[]) => void;
}) {
  const [kind, setKind] = useState<"LABOR" | "PART">("LABOR");
  const [q, setQ] = useState("");
  const catalog = trpc.repairOrder.catalog.useQuery({ q, kind }, { enabled: q.trim().length >= 2 });
  const selected = labor.length + parts.length;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-2 text-sm">
      <span className="font-medium">
        {t("inspection.recommendations")} ({selected})
      </span>
      <div className="flex gap-2">
        {(["LABOR", "PART"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-11 rounded-md px-3 ${kind === k ? "bg-accent text-accent-foreground" : "bg-surface"}`}
          >
            + {t(k === "LABOR" ? "inspection.addLabor" : "inspection.addPart")}
          </button>
        ))}
      </div>
      <Input
        aria-label={t("lines.catalogSearch")}
        placeholder={t("lines.catalogSearch")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {catalog.data?.map((c) => {
        const list = kind === "LABOR" ? labor : parts;
        const on = list.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            className={`flex min-h-11 items-center justify-between rounded px-2 text-left ${on ? "bg-status-ok-bg" : "bg-surface"}`}
            onClick={() => {
              const next = on ? list.filter((x) => x !== c.id) : [...list, c.id];
              if (kind === "LABOR") onChange(next, parts);
              else onChange(labor, next);
            }}
          >
            <span>
              {on ? "✓ " : ""}
              {c.name}
            </span>
            <span className="text-muted">{formatFCFA(c.unitPrice)}</span>
          </button>
        );
      })}
    </div>
  );
}
