// RG-M09-15 — lignes du relevé de compte : chronologie débit/crédit avec solde cumulé.

export interface StatementEntryInput {
  date: Date;
  kind: "invoice" | "credit_note" | "payment";
  reference: string;
  label: string;
  amount: number;
}

export interface StatementLine extends StatementEntryInput {
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface Statement {
  openingBalance: number;
  closingBalance: number;
  lines: StatementLine[];
  totalDebit: number;
  totalCredit: number;
}

/** `entries` couvre toute l'histoire ; celles avant `from` constituent le solde d'ouverture. */
export function buildStatement(entries: StatementEntryInput[], from: Date, to: Date): Statement {
  const signed = (e: StatementEntryInput) =>
    e.kind === "invoice" ? Math.abs(e.amount) : -Math.abs(e.amount);
  const sorted = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || (a.kind === "invoice" ? -1 : 1),
  );
  let opening = 0;
  const lines: StatementLine[] = [];
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of sorted) {
    if (e.date.getTime() < from.getTime()) {
      opening += signed(e);
      running = opening;
      continue;
    }
    if (e.date.getTime() > to.getTime()) continue;
    const value = signed(e);
    running += value;
    const debit = value > 0 ? value : 0;
    const credit = value < 0 ? -value : 0;
    totalDebit += debit;
    totalCredit += credit;
    lines.push({ ...e, debit, credit, runningBalance: running });
  }
  if (lines.length === 0) running = opening;
  return { openingBalance: opening, closingBalance: running, lines, totalDebit, totalCredit };
}

/** `Releve-SOTRA-Logistique-2026-10-18.pdf`. */
export function statementFileName(customerName: string, asOf: Date): string {
  const slug = customerName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Releve-${slug}-${asOf.toISOString().slice(0, 10)}.pdf`;
}
