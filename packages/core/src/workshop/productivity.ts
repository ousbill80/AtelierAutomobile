// M06 RG-M06-08/09/10 — temps facturé attribué, indicateurs par mécanicien, coût MO.
import type { Payer } from "../repairOrders/types";

export type TimeEntryKindValue = "WORK" | "DIAGNOSTIC" | "REWORK";

export interface BilledLaborLine {
  id: string;
  /** Heures vendues (`quantity` de la ligne LABOR). */
  quantity: number;
  assignedToId: string | null;
  payer: Payer;
}

export interface WorkedMinutes {
  repairOrderLineId: string | null;
  membershipId: string;
  minutes: number;
  kind: TimeEntryKindValue;
}

export interface AttributedHours {
  /** Heures facturées au client attribuées (F). */
  billedHours: number;
  /** Heures des lignes WARRANTY/INTERNAL (« heures non facturées client »). */
  nonCustomerHours: number;
}

/**
 * RG-M06-08 : pour chaque ligne LABOR facturée, les heures vendues sont réparties entre
 * mécaniciens au prorata de leurs minutes pointées hors REWORK ; sans pointage, elles vont à
 * `assignedToId`. Les lignes WARRANTY/INTERNAL sont comptées à part.
 */
export function attributeBilledHours(
  lines: readonly BilledLaborLine[],
  entries: readonly WorkedMinutes[],
): Map<string, AttributedHours> {
  const result = new Map<string, AttributedHours>();
  const add = (membershipId: string, hours: number, customer: boolean) => {
    const current = result.get(membershipId) ?? { billedHours: 0, nonCustomerHours: 0 };
    if (customer) current.billedHours += hours;
    else current.nonCustomerHours += hours;
    result.set(membershipId, current);
  };
  for (const line of lines) {
    const customer = line.payer !== "WARRANTY" && line.payer !== "INTERNAL";
    const perMechanic = new Map<string, number>();
    for (const e of entries) {
      if (e.repairOrderLineId !== line.id || e.kind === "REWORK" || e.minutes <= 0) continue;
      perMechanic.set(e.membershipId, (perMechanic.get(e.membershipId) ?? 0) + e.minutes);
    }
    const total = [...perMechanic.values()].reduce((s, m) => s + m, 0);
    if (total > 0) {
      for (const [membershipId, minutes] of perMechanic) {
        add(membershipId, (line.quantity * minutes) / total, customer);
      }
    } else if (line.assignedToId) {
      add(line.assignedToId, line.quantity, customer);
    }
  }
  return result;
}

export interface AttendanceLike {
  clockIn: Date | null;
  clockOut: Date | null;
  breakMinutes: number;
}

/** Présence d'une journée : `clockOut − clockIn − breakMinutes` (≥ 0) ; ouverte → jusqu'à `now`. */
export function presenceMinutes(attendance: AttendanceLike, now: Date): number {
  if (!attendance.clockIn) return 0;
  const end = attendance.clockOut ?? now;
  const minutes = Math.floor((end.getTime() - attendance.clockIn.getTime()) / 60_000);
  return Math.max(0, minutes - attendance.breakMinutes);
}

/** RG-M06-10 : coût = Σ (minutes/60 × coût horaire), arrondi à l'entier FCFA par entrée. */
export function laborCost(entryMinutes: readonly number[], hourlyCost: number | null): number {
  if (!hourlyCost) return 0;
  return entryMinutes.reduce((sum, m) => sum + Math.round((m / 60) * hourlyCost), 0);
}

export interface ProductivityInput {
  presenceMinutes: number;
  workedMinutes: number;
  reworkMinutes: number;
  billedHours: number;
  laborCost: number;
}

export interface ProductivityMetrics {
  presenceH: number;
  workedH: number;
  billedH: number;
  reworkH: number;
  /** F / T × 100, `null` si T = 0 (« — »). */
  efficiency: number | null;
  /** T / P × 100. */
  productivity: number | null;
  /** F / P × 100. */
  overall: number | null;
  laborCost: number;
  /** §11 : efficacité > 300 % → « à vérifier » (pointage probablement oublié). */
  toCheck: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);

/** RG-M06-09 — efficacité, productivité, rendement global (arrondis à l'entier). */
export function productivityMetrics(input: ProductivityInput): ProductivityMetrics {
  const presenceH = input.presenceMinutes / 60;
  const workedH = input.workedMinutes / 60;
  const efficiency = pct(input.billedHours, workedH);
  return {
    presenceH: round2(presenceH),
    workedH: round2(workedH),
    billedH: round2(input.billedHours),
    reworkH: round2(input.reworkMinutes / 60),
    efficiency,
    productivity: pct(workedH, presenceH),
    overall: pct(input.billedHours, presenceH),
    laborCost: input.laborCost,
    toCheck: efficiency !== null && efficiency > 300,
  };
}
