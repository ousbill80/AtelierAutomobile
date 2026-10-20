// RG-M05-04 / RG-M05-11 — décision du client : par groupe (portail) ou par ligne (personnel),
// statut résultant, dépendances entre groupes et décision complémentaire (amendement).
import { DomainError } from "../errors";
import type { QuoteLineLike, QuoteStatus } from "./types";

export type DecisionLine = Pick<
  QuoteLineLike,
  "id" | "isOptional" | "groupKey" | "groupLabel" | "requiresGroupKey" | "accepted" | "description"
>;

export interface LineDecision {
  lineId?: string;
  groupKey?: string;
  accepted: boolean;
  declineReason?: string | null;
}

export interface DecisionResult {
  status: Extract<QuoteStatus, "ACCEPTED" | "PARTIALLY_ACCEPTED" | "DECLINED">;
  accepted: Map<string, boolean>;
  acceptedLineIds: string[];
  declinedLineIds: string[];
  declineReasons: Map<string, string>;
}

/** Clé de groupe d'une ligne : `groupKey` ou la ligne seule. */
export function groupKeyOf(line: Pick<QuoteLineLike, "id" | "groupKey">): string {
  return line.groupKey ?? `line:${line.id}`;
}

export function statusFromAcceptance(values: readonly boolean[]): DecisionResult["status"] {
  const yes = values.filter(Boolean).length;
  if (values.length > 0 && yes === values.length) return "ACCEPTED";
  if (yes === 0) return "DECLINED";
  return "PARTIALLY_ACCEPTED";
}

/**
 * `decisionResult(lines, decisions)` (§12) : applique les décisions de groupe puis de ligne,
 * considère refusées les lignes optionnelles non touchées, refuse une ligne non optionnelle non
 * décidée (`NON_OPTIONAL_UNDECIDED`) et une acceptation dont le groupe requis est refusé.
 */
export function decisionResult(
  lines: readonly DecisionLine[],
  decisions: readonly LineDecision[],
): DecisionResult {
  if (lines.length === 0) {
    throw new DomainError("quote.no_line", "Le devis ne contient aucune ligne.");
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  const accepted = new Map<string, boolean>();
  const reasons = new Map<string, string>();
  for (const d of decisions) {
    if (d.groupKey) {
      for (const l of lines.filter((x) => groupKeyOf(x) === d.groupKey)) {
        accepted.set(l.id, d.accepted);
        if (!d.accepted && d.declineReason) reasons.set(l.id, d.declineReason);
      }
    }
  }
  for (const d of decisions) {
    if (d.lineId) {
      if (!byId.has(d.lineId)) {
        throw new DomainError("quote.unknown_line", "Ligne inconnue dans la décision.", {
          lineId: d.lineId,
        });
      }
      accepted.set(d.lineId, d.accepted);
      if (!d.accepted && d.declineReason) reasons.set(d.lineId, d.declineReason);
    }
  }
  const undecided = lines.filter((l) => !accepted.has(l.id) && !l.isOptional);
  if (undecided.length > 0) {
    throw new DomainError(
      "NON_OPTIONAL_UNDECIDED",
      `Décidez les travaux obligatoires : ${undecided.map((l) => l.groupLabel ?? l.description).join(", ")}.`,
      { lineIds: undecided.map((l) => l.id) },
    );
  }
  for (const l of lines) if (!accepted.has(l.id)) accepted.set(l.id, false);

  // Dépendances : un groupe ne peut pas être accepté si le groupe requis est entièrement refusé.
  for (const l of lines) {
    if (!l.requiresGroupKey || !accepted.get(l.id)) continue;
    const parents = lines.filter((p) => groupKeyOf(p) === l.requiresGroupKey);
    if (parents.length > 0 && parents.every((p) => accepted.get(p.id) === false)) {
      const label = parents[0]!.groupLabel ?? parents[0]!.description;
      throw new DomainError("quote.dependency_declined", `Nécessite : ${label}.`, {
        lineId: l.id,
        requires: l.requiresGroupKey,
      });
    }
  }
  const values = lines.map((l) => accepted.get(l.id)!);
  return {
    status: statusFromAcceptance(values),
    accepted,
    acceptedLineIds: lines.filter((l) => accepted.get(l.id)).map((l) => l.id),
    declinedLineIds: lines.filter((l) => !accepted.get(l.id)).map((l) => l.id),
    declineReasons: reasons,
  };
}

/**
 * RG-M05-11 — décision complémentaire (`amendment = true`) : uniquement refusé → accepté.
 * Renvoie la nouvelle acceptation et les lignes basculées.
 */
export function amendDecision(
  lines: readonly DecisionLine[],
  decisions: readonly LineDecision[],
): DecisionResult & { switchedLineIds: string[] } {
  const accepted = new Map(lines.map((l) => [l.id, l.accepted === true]));
  const switched: string[] = [];
  for (const d of decisions) {
    const targets = d.groupKey
      ? lines.filter((l) => groupKeyOf(l) === d.groupKey)
      : lines.filter((l) => l.id === d.lineId);
    for (const l of targets) {
      if (!d.accepted) {
        if (l.accepted === true) {
          throw new DomainError(
            "quote.amendment_forbidden",
            "Une décision complémentaire ne peut qu'accepter des travaux refusés.",
          );
        }
        continue;
      }
      if (l.accepted !== false) continue;
      accepted.set(l.id, true);
      switched.push(l.id);
    }
  }
  if (switched.length === 0) {
    throw new DomainError(
      "quote.amendment_empty",
      "Choisissez au moins un travail refusé à accepter.",
    );
  }
  const values = lines.map((l) => accepted.get(l.id)!);
  return {
    status: statusFromAcceptance(values),
    accepted,
    acceptedLineIds: lines.filter((l) => accepted.get(l.id)).map((l) => l.id),
    declinedLineIds: lines.filter((l) => !accepted.get(l.id)).map((l) => l.id),
    declineReasons: new Map(),
    switchedLineIds: switched,
  };
}
