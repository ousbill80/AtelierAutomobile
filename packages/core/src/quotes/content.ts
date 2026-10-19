// RG-M05-10 — contenu canonique du devis (hash `decisionHash`, contrôle `QUOTE_CHANGED`),
// écarts entre versions (US-M05-08 / US-M05-10), messages pré-rédigés (US-M05-04/07).
import { formatFCFA } from "../money/format";
import type { QuoteLineLike } from "./types";

export interface CanonicalLine extends Pick<
  QuoteLineLike,
  "id" | "description" | "quantity" | "unitPrice" | "discountRate" | "vatRate" | "payer"
> {
  lineTotal: number;
  groupKey?: string | null;
}

/**
 * Sérialisation stable (lignes triées par id, clés dans un ordre fixe) : le SHA-256 de cette
 * chaîne (calculé côté serveur) est l'empreinte signée. Toute modification de prix, quantité,
 * remise, TVA, payeur, libellé ou total la change ; l'ordre d'affichage non.
 */
export function canonicalQuoteContent(input: {
  number: string;
  version: number;
  total: number;
  lines: readonly CanonicalLine[];
}): string {
  const lines = [...input.lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => [
      l.id,
      l.description,
      l.quantity,
      l.unitPrice,
      l.discountRate,
      l.vatRate,
      l.payer,
      l.lineTotal,
      l.groupKey ?? null,
    ]);
  return JSON.stringify({ n: input.number, v: input.version, t: input.total, l: lines });
}

// ───────────── Écarts entre versions ─────────────

export interface DiffLine {
  type: string;
  description: string;
  productId?: string | null;
  laborOperationId?: string | null;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  lineTotal: number;
}

export interface QuoteVersionDiff {
  added: DiffLine[];
  removed: DiffLine[];
  changed: {
    before: DiffLine;
    after: DiffLine;
    fields: ("quantity" | "unitPrice" | "discountRate")[];
  }[];
  totalBefore: number;
  totalAfter: number;
  totalDelta: number;
}

function matchKey(l: DiffLine): string {
  return `${l.type}|${l.productId ?? l.laborOperationId ?? l.description.trim().toLowerCase()}`;
}

export function diffQuoteVersions(
  before: { total: number; lines: readonly DiffLine[] },
  after: { total: number; lines: readonly DiffLine[] },
): QuoteVersionDiff {
  const pool = new Map<string, DiffLine[]>();
  for (const l of before.lines) {
    const k = matchKey(l);
    pool.set(k, [...(pool.get(k) ?? []), l]);
  }
  const added: DiffLine[] = [];
  const changed: QuoteVersionDiff["changed"] = [];
  for (const l of after.lines) {
    const candidates = pool.get(matchKey(l));
    const prev = candidates?.shift();
    if (!prev) {
      added.push(l);
      continue;
    }
    const fields = (["quantity", "unitPrice", "discountRate"] as const).filter(
      (f) => prev[f] !== l[f],
    );
    if (fields.length > 0) changed.push({ before: prev, after: l, fields: [...fields] });
  }
  const removed = [...pool.values()].flat();
  return {
    added,
    removed,
    changed,
    totalBefore: before.total,
    totalAfter: after.total,
    totalDelta: after.total - before.total,
  };
}

// ───────────── Messages ─────────────

export interface QuoteSendMessageInput {
  customerName: string;
  number: string;
  vehicle?: string | null;
  plate?: string | null;
  total: number;
  urgentTotal: number;
  link: string;
  garageName: string;
}

/** US-M05-04 — message pré-rédigé d'envoi du devis. */
export function quoteSendMessage(input: QuoteSendMessageInput): string {
  const vehicle = input.vehicle
    ? ` pour votre ${input.vehicle}${input.plate ? ` (${input.plate})` : ""}`
    : "";
  const urgent = input.urgentTotal > 0 ? ` (dont ${formatFCFA(input.urgentTotal)} urgents)` : "";
  return `Bonjour ${input.customerName}, voici le devis ${input.number}${vehicle} : ${formatFCFA(input.total)} TTC${urgent}. Consultez-le et validez les travaux ici : ${input.link} — ${input.garageName}`;
}

/** US-M05-07 — confirmation écrite d'un accord donné au téléphone. */
export function phoneConfirmationMessage(input: {
  time: string;
  accepted: { label: string; total: number }[];
  declined: string[];
}): string {
  const acceptedText =
    input.accepted.length > 0
      ? input.accepted.map((a) => `${a.label} (${formatFCFA(a.total)} TTC)`).join(", ")
      : "aucun travail";
  const declinedText = input.declined.length > 0 ? ` Refusé : ${input.declined.join(", ")}.` : "";
  return `Suite à notre appel de ${input.time}, vous avez accepté : ${acceptedText}.${declinedText} Si ce n'est pas correct, répondez à ce message.`;
}

// ───────────── Catalogue MO : durées par véhicule (RG-M05-05) ─────────────

export interface VehicleOverride {
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  standardHours: number;
}

/** Temps barème spécifique au véhicule (ex. distribution : 3 h Corolla, 4,5 h Hilux). */
export function laborHoursForVehicle(
  standardHours: number,
  overrides: readonly VehicleOverride[],
  vehicle?: { make?: string | null; model?: string | null; year?: number | null } | null,
): number {
  if (!vehicle?.make) return standardHours;
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const matches = overrides.filter(
    (o) =>
      norm(o.make) === norm(vehicle.make) &&
      (!o.model || norm(o.model) === norm(vehicle.model)) &&
      (o.yearFrom == null || (vehicle.year != null && vehicle.year >= o.yearFrom)) &&
      (o.yearTo == null || (vehicle.year != null && vehicle.year <= o.yearTo)),
  );
  // La règle la plus précise (avec modèle) l'emporte.
  const best = matches.sort((a, b) => Number(Boolean(b.model)) - Number(Boolean(a.model)))[0];
  return best ? best.standardHours : standardHours;
}
