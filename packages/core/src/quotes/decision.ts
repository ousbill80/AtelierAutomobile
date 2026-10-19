// RG-M05-04 / RG-M05-11 — décision par groupe ou par ligne, statut résultant, dépendances.
import { DomainError } from "../errors";
import type { QuoteLineLike, QuoteStatus } from "./types";

export interface LineDecisionInput {
  lineId?: string;
  groupKey?: string;
  accepted: boolean;
  declineReason?: string | null;
}

export interface DecisionOptions {
  /** RG-M05-11 : décision complémentaire — seules les lignes refusées peuvent passer acceptées. */
  amendment?: boolean;
  /** Portail : la décision se fait par groupe (une ligne sans groupe est son propre groupe). */
  byGroup?: boolean;
}

export interface LineDecision {
  id: string;
  accepted: boolean;
  declineReason: string | null;
}

export interface DecisionResult {
  status: Extract<QuoteStatus, "ACCEPTED" | "PARTIALLY_ACCEPTED" | "DECLINED">;
  lines: LineDecision[];
}

type DecidableLine = QuoteLineLike & { id: string };

/** Clé de groupe effective : `groupKey` sinon l'id de la ligne. */
export function effectiveGroupKey(line: Pick<QuoteLineLike, "id" | "groupKey">): string {
  return line.groupKey ?? `line:${line.id ?? ""}`;
}

/**
 * Applique les décisions et calcule le statut (RG-M05-11) :
 * - toutes acceptées → ACCEPTED ; au moins une de chaque → PARTIALLY_ACCEPTED ; toutes refusées → DECLINED ;
 * - une ligne non optionnelle non décidée → erreur `NON_OPTIONAL_UNDECIDED` ;
 * - une ligne optionnelle non touchée est refusée ;
 * - une ligne dont le groupe requis (`requiresGroupKey`) est refusé est refusée (§11).
 */
export function decisionResult(
  lines: readonly DecidableLine[],
  decisions: readonly LineDecisionInput[],
  options: DecisionOptions = {},
): DecisionResult {
  if (lines.length === 0) {
    throw new DomainError("quotes.no_lines", "Le devis ne contient aucune ligne.");
  }
  const accepted = new Map<string, boolean>();
  const reasons = new Map<string, string | null>();

  const apply = (line: DecidableLine, value: boolean, reason?: string | null) => {
    if (options.amendment) {
      // Décision complémentaire : uniquement refusé → accepté.
      if (line.accepted === true || (line.accepted === false && value === false)) return;
      if (line.accepted == null) return;
    }
    accepted.set(line.id, value);
    reasons.set(line.id, value ? null : (reason ?? null));
  };

  for (const decision of decisions) {
    if (decision.groupKey !== undefined) {
      const members = lines.filter((l) => effectiveGroupKey(l) === decision.groupKey);
      if (members.length === 0) {
        throw new DomainError("quotes.unknown_group", "Groupe de lignes inconnu.", {
          groupKey: decision.groupKey,
        });
      }
      for (const member of members) apply(member, decision.accepted, decision.declineReason);
      continue;
    }
    if (decision.lineId !== undefined) {
      const line = lines.find((l) => l.id === decision.lineId);
      if (!line) {
        throw new DomainError("quotes.unknown_line", "Ligne de devis inconnue.", {
          lineId: decision.lineId,
        });
      }
      if (options.byGroup) {
        for (const member of lines.filter((l) => effectiveGroupKey(l) === effectiveGroupKey(line))) {
          apply(member, decision.accepted, decision.declineReason);
        }
      } else {
        apply(line, decision.accepted, decision.declineReason);
      }
    }
  }

  // Lignes non touchées : conserve une décision antérieure (amendement), sinon optionnelle → refusée.
  const undecided: string[] = [];
  for (const line of lines) {
    if (accepted.has(line.id)) continue;
    if (options.amendment && line.accepted != null) {
      accepted.set(line.id, line.accepted);
      reasons.set(line.id, null);
      continue;
    }
    if (line.isOptional) {
      accepted.set(line.id, false);
      reasons.set(line.id, null);
    } else {
      undecided.push(line.id);
    }
  }
  if (undecided.length > 0) {
    throw new DomainError(
      "NON_OPTIONAL_UNDECIDED",
      "Certains travaux non optionnels n'ont pas été décidés.",
      { lineIds: undecided },
    );
  }

  // Dépendances : un groupe requis refusé entraîne le refus des lignes qui en dépendent.
  const groupAccepted = new Map<string, boolean>();
  for (const line of lines) {
    const key = effectiveGroupKey(line);
    groupAccepted.set(key, (groupAccepted.get(key) ?? false) || accepted.get(line.id)!);
  }
  for (const line of lines) {
    if (line.requiresGroupKey && groupAccepted.get(line.requiresGroupKey) === false) {
      accepted.set(line.id, false);
      reasons.set(line.id, reasons.get(line.id) ?? "REQUIRES_PARENT");
    }
  }

  const values = lines.map((l) => accepted.get(l.id)!);
  const anyAccepted = values.some(Boolean);
  const anyDeclined = values.some((v) => !v);
  const status = !anyAccepted ? "DECLINED" : anyDeclined ? "PARTIALLY_ACCEPTED" : "ACCEPTED";
  return {
    status,
    lines: lines.map((l) => ({
      id: l.id,
      accepted: accepted.get(l.id)!,
      declineReason: reasons.get(l.id) ?? null,
    })),
  };
}
