// RG-M04-15 — frais de gardiennage proposés (jamais automatiques), jours ouvrés (dimanche exclu).
import { formatFCFA } from "../money/format";

const DAY_MS = 86_400_000;

function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ddmm(date: Date): string {
  const [, m, d] = toKey(date).split("-");
  return `${d}/${m}`;
}

export interface StorageFeeInput {
  /** Jour civil du passage en READY (`@db.Date`, minuit UTC). */
  readyOn: Date;
  /** Jour civil courant. */
  today: Date;
  /** `settings.repairOrders.storageFeeAfterDays` (jours ouvrés de grâce). */
  afterDays: number;
  perDay: number;
  /** Jours fériés (`@db.Date`) exclus du décompte. */
  holidays?: readonly Date[];
}

export interface StorageFeeProposal {
  from: Date;
  to: Date;
  days: number;
  amount: number;
  /** Libellé de la ligne FEE proposée. */
  description: string;
}

/**
 * Les frais courent à partir du jour ouvré qui suit les `afterDays` jours ouvrés de grâce,
 * jusqu'à aujourd'hui inclus, dimanches et jours fériés exclus. `null` si rien n'est dû.
 */
export function storageFee(input: StorageFeeInput): StorageFeeProposal | null {
  const holidays = new Set((input.holidays ?? []).map(toKey));
  const isOff = (d: Date) => isSunday(d) || holidays.has(toKey(d));
  let cursor = new Date(input.readyOn.getTime());
  let grace = Math.max(0, input.afterDays);
  while (grace > 0) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (!isOff(cursor)) grace -= 1;
  }
  let start = new Date(cursor.getTime() + DAY_MS);
  while (isOff(start)) start = new Date(start.getTime() + DAY_MS);
  if (start.getTime() > input.today.getTime()) return null;

  let days = 0;
  for (let d = start; d.getTime() <= input.today.getTime(); d = new Date(d.getTime() + DAY_MS)) {
    if (!isOff(d)) days += 1;
  }
  if (days === 0) return null;
  const amount = days * input.perDay;
  return {
    from: start,
    to: input.today,
    days,
    amount,
    description: `Frais de gardiennage du ${ddmm(start)} au ${ddmm(input.today)} (${days} j × ${formatFCFA(input.perDay)})`,
  };
}
