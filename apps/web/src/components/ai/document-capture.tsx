"use client";

// M17 US-M17-06 / RG-M17-18 — « Photographier un document » : la photo est redimensionnée à
// 1 600 px dans le navigateur (canvas, EXIF supprimé), envoyée à `ai.extractDocument`, et les
// champs proposés sont rendus au formulaire appelant, qui reste seul à enregistrer.
import { useRef, useState, type ChangeEvent } from "react";
import { Sparkles } from "lucide-react";
import { compressImage, StatusBadge } from "@atelieros/ui";
import { t } from "@/lib/i18n";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type DocumentKind =
  "VEHICLE_REGISTRATION" | "INSPECTION_STICKER" | "ODOMETER" | "SUPPLIER_INVOICE" | "CLAIM_REPORT";

export type ExtractionResult = Extract<RouterOutputs["ai"]["extractDocument"], { ok: true }>;
export type ExtractedFields = ExtractionResult["fields"];

interface DocumentCaptureProps {
  kinds: DocumentKind[];
  onExtracted: (result: ExtractionResult, kind: DocumentKind) => void;
}

export function DocumentCapture({ kinds, onExtracted }: DocumentCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>(kinds[0]!);
  const [message, setMessage] = useState<{ tone: "warn" | "bad" | "ok"; text: string } | null>(
    null,
  );
  const status = trpc.ai.status.useQuery(undefined, { staleTime: 60_000 });
  const extract = trpc.ai.extractDocument.useMutation();
  const availability = status.data?.document_extraction;
  const unavailableReason =
    availability && !availability.available ? availability.reason : undefined;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(null);
    try {
      const image = await compressImage(file, 1600, 0.85);
      const result = await extract.mutateAsync({
        kind,
        image: { mediaType: image.mimeType, dataBase64: image.base64 },
      });
      if (!result.ok) {
        setMessage({ tone: "warn", text: t("aiExtraction.fallback", { reason: result.reason }) });
        return;
      }
      if (result.unreadable) {
        setMessage({ tone: "bad", text: t("aiExtraction.unreadable") });
        return;
      }
      onExtracted(result, kind);
      setMessage({
        tone: result.warnings.length ? "warn" : "ok",
        text: [t("aiExtraction.filled"), ...result.warnings].join(" "),
      });
    } catch (error) {
      setMessage({
        tone: "bad",
        text: error instanceof Error ? error.message : t("aiExtraction.error"),
      });
    }
  }

  const disabled = extract.isPending || Boolean(unavailableReason) || status.isLoading;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {kinds.length > 1 && (
          <select
            aria-label={t("aiExtraction.kindLabel")}
            className="h-11 rounded-md border border-border bg-surface px-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`aiExtraction.kinds.${k}`)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn btn-secondary inline-flex min-h-11 items-center gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          title={unavailableReason ?? t("aiExtraction.hint")}
          data-testid="document-capture"
        >
          <Sparkles className="size-4" aria-hidden />
          {extract.isPending ? t("aiExtraction.reading") : t("aiExtraction.take")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFile}
        />
      </div>
      {extract.isPending && (
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" aria-hidden />
      )}
      {unavailableReason && <p className="text-xs text-muted">{unavailableReason}</p>}
      {message && (
        <p role="status" className="text-sm">
          <StatusBadge
            tone={message.tone}
            label={message.tone === "ok" ? t("aiExtraction.suggested") : t("aiExtraction.check")}
          />{" "}
          {message.text}
        </p>
      )}
    </div>
  );
}

/** Indicateur de confiance d'un champ pré-rempli (« À vérifier » sous 0,7). */
export function ExtractedHint({ field }: { field: ExtractedFields[string] | undefined }) {
  if (!field) return null;
  const pct = Math.round(field.confidence * 100);
  return field.needsReview ? (
    <StatusBadge tone="warn" label={t("aiExtraction.needsReview", { pct })} />
  ) : (
    <StatusBadge tone="ok" label={t("aiExtraction.confidence", { pct })} />
  );
}

/** Classe de surlignage d'un champ pré-rempli par l'assistant. */
export function extractedClass(field: ExtractedFields[string] | undefined): string {
  if (!field) return "";
  return field.needsReview
    ? "rounded-md ring-2 ring-status-warn ring-offset-1"
    : "rounded-md ring-2 ring-accent/40 ring-offset-1";
}
