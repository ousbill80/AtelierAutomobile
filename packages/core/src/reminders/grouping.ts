import type { ReminderType } from "./types";

/**
 * RG-M10-14 — clé de destinataire normalisée (téléphone E.164 ou email en minuscules). Toutes les
 * règles anti-spam et de regroupement se calculent par adresse, jamais par `customerId` : deux
 * fiches en double issues d'un import (même numéro) ne reçoivent jamais deux messages.
 */
export function recipientKey(input: {
  phoneE164?: string | null;
  email?: string | null;
}): string | null {
  if (input.phoneE164) return input.phoneE164;
  if (input.email) return input.email.trim().toLowerCase();
  return null;
}

export interface GroupableReminder {
  id: string;
  recipientKey: string;
  type: ReminderType;
  stepKey: string;
  /** `"yyyy-MM-dd"` dans le fuseau de l'organisation : jour d'envoi prévu. */
  scheduledDateKey: string;
  vehicleId?: string | null;
  /** `RECEIVABLE` : dossier de recouvrement (un dossier = un message). */
  caseId?: string | null;
}

/** RG-M10-15 — `"{recipientKey}:{type}:{stepKey}:{yyyy-MM-dd}"`, ou par dossier pour `RECEIVABLE`. */
export function groupKey(reminder: GroupableReminder): string {
  if (reminder.type === "RECEIVABLE" && reminder.caseId) {
    return `${reminder.recipientKey}:RECEIVABLE:${reminder.caseId}`;
  }
  return `${reminder.recipientKey}:${reminder.type}:${reminder.stepKey}:${reminder.scheduledDateKey}`;
}

export type GroupTemplateKind = "single" | "multi" | "combo";

export interface ReminderGroup {
  key: string;
  reminderIds: string[];
  vehicleIds: (string | null | undefined)[];
  /** `single` = 1 véhicule ; `multi` = ≥ 2 (modèle `vt_multi`/`rev_multi`) ; `combo` = VT + révision le même jour. */
  templateKind: GroupTemplateKind;
  /** RG-M10-15 — au-delà de 10 véhicules, la liste est tronquée côté rendu, pas ici. */
  truncatedVehicleCount?: number;
}

/**
 * RG-M10-15 — regroupe les relances dues par `(recipientKey, type, stepKey, jour)` (ou par
 * dossier pour `RECEIVABLE`), puis fusionne en un groupe `combo` les paires VT + révision du même
 * véhicule dues le même jour pour le même destinataire.
 */
export function groupReminders(
  reminders: readonly GroupableReminder[],
  maxListedVehicles = 10,
): ReminderGroup[] {
  const byKey = new Map<string, GroupableReminder[]>();
  for (const r of reminders) {
    const key = groupKey(r);
    const bucket = byKey.get(key) ?? [];
    bucket.push(r);
    byKey.set(key, bucket);
  }

  const groups: ReminderGroup[] = Array.from(byKey.entries()).map(([key, members]) => {
    const vehicleIds = members.map((m) => m.vehicleId);
    const uniqueVehicleCount = new Set(vehicleIds.filter(Boolean)).size;
    return {
      key,
      reminderIds: members.map((m) => m.id),
      vehicleIds,
      templateKind: uniqueVehicleCount >= 2 ? "multi" : "single",
      truncatedVehicleCount:
        uniqueVehicleCount > maxListedVehicles ? uniqueVehicleCount - maxListedVehicles : undefined,
    } satisfies ReminderGroup;
  });

  return combineInspectionAndServiceCombos(groups, reminders);
}

/** RG-M10-15 — « VT et révision du même véhicule dues le même jour : un seul message `vt_rev_combo` ». */
function combineInspectionAndServiceCombos(
  groups: ReminderGroup[],
  reminders: readonly GroupableReminder[],
): ReminderGroup[] {
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const consumed = new Set<string>();
  const result: ReminderGroup[] = [];

  for (const group of groups) {
    if (consumed.has(group.key)) continue;
    const member = byId.get(group.reminderIds[0] as string);
    if (
      !member ||
      (member.type !== "INSPECTION" && member.type !== "SERVICE") ||
      !member.vehicleId
    ) {
      result.push(group);
      continue;
    }

    const otherType: ReminderType = member.type === "INSPECTION" ? "SERVICE" : "INSPECTION";
    const match = groups.find((candidate) => {
      if (candidate.key === group.key || consumed.has(candidate.key)) return false;
      const candidateMember = byId.get(candidate.reminderIds[0] as string);
      return (
        candidateMember?.type === otherType &&
        candidateMember.vehicleId === member.vehicleId &&
        candidateMember.recipientKey === member.recipientKey &&
        candidateMember.scheduledDateKey === member.scheduledDateKey
      );
    });

    if (match) {
      consumed.add(group.key);
      consumed.add(match.key);
      result.push({
        key: `${member.recipientKey}:VT_REV_COMBO:${member.vehicleId}:${member.scheduledDateKey}`,
        reminderIds: [...group.reminderIds, ...match.reminderIds],
        vehicleIds: [member.vehicleId],
        templateKind: "combo",
      });
    } else {
      result.push(group);
    }
  }

  return result;
}
