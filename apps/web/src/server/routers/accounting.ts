// RG-M08-31 — `accounting.export` : journaux VT (ventes), EN (encaissements), CA (caisse) au
// format SYSCOHADA, ou journal des ventes lisible. Le CSV est renvoyé au client (téléchargement).
import {
  assertBalanced,
  cashEntries,
  formatDate,
  receiptEntries,
  salesEntries,
  syscohadaCsv,
  toCsv,
  type AccountingEntry,
  type PaymentMethodLike,
} from "@atelieros/core";
import { addDaysToKey, zonedInstant } from "@atelieros/core/planning";
import { db } from "@atelieros/db";
import { accountingExportInputSchema, type AccountingExportInput } from "@atelieros/validators";
import { loadOrgBillingContext, type OrgBillingContext } from "../billing/service";
import { requirePermission, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;

/** Compte tiers du client : `C` + fin d'identifiant (stable, sans donnée personnelle). */
function thirdParty(customerId: string): string {
  return `C${customerId.slice(-6).toUpperCase()}`;
}

export async function buildAccountingExport(
  tenantDb: TenantDb,
  org: OrgBillingContext,
  input: AccountingExportInput,
) {
  const from = zonedInstant(input.from, 0, org.timeZone);
  const to = zonedInstant(addDaysToKey(input.to, 1), 0, org.timeZone);
  const range = { gte: from, lt: to };
  const day = (d: Date) => formatDate(d, org.timeZone);
  const wants = (j: "VT" | "EN" | "CA") => input.journal === "ALL" || input.journal === j;
  const accounts = org.settings.accounts;

  const invoices =
    wants("VT") || input.format === "sales_csv"
      ? await tenantDb.invoice.findMany({
          where: { status: { not: "DRAFT" }, issuedAt: range, origin: "NATIVE" },
          orderBy: [{ issuedAt: "asc" }, { number: "asc" }],
          include: {
            customer: { select: { id: true, displayName: true } },
            lines: { select: { type: true, lineSubtotal: true } },
            creditedInvoice: { select: { number: true } },
          },
        })
      : [];

  if (input.format === "sales_csv") {
    const rows = invoices.map((i) => [
      i.number ?? "",
      day(i.issuedAt!),
      i.type === "CREDIT_NOTE" ? "Avoir" : i.type === "DEPOSIT" ? "Acompte" : "Facture",
      i.customer.displayName,
      i.subtotal,
      i.vatTotal,
      i.total,
      i.amountPaid,
      i.balance,
      i.status,
      i.fneStatus,
      i.fneNumber ?? "",
    ]);
    const csv = toCsv(
      [
        "N° facture",
        "Date",
        "Type",
        "Client",
        "Total HT",
        "TVA",
        "Total TTC",
        "Payé",
        "Solde",
        "Statut",
        "FNE",
        "N° FNE",
      ],
      rows,
    );
    return {
      fileName: `journal-ventes_${input.from}_${input.to}.csv`,
      csv,
      entries: [] as AccountingEntry[],
      debit: 0,
      credit: 0,
      count: rows.length,
    };
  }

  const entries: AccountingEntry[] = [];
  if (wants("VT")) {
    entries.push(
      ...salesEntries(
        invoices.map((i) => ({
          number: i.number!,
          date: day(i.issuedAt!),
          type: i.type,
          customerName: i.customer.displayName,
          customerAccount: thirdParty(i.customer.id),
          reference: i.creditedInvoice?.number ?? null,
          lines: i.lines,
          vatTotal: i.vatTotal,
          total: i.total,
        })),
        accounts,
      ),
    );
  }
  if (wants("EN")) {
    const [payments, refunds] = await Promise.all([
      tenantDb.payment.findMany({
        where: { status: { in: ["CONFIRMED", "REFUNDED"] }, voidedAt: null, receivedAt: range },
        orderBy: [{ receivedAt: "asc" }, { number: "asc" }],
        include: { customer: { select: { id: true, displayName: true } } },
      }),
      tenantDb.refund.findMany({
        where: { createdAt: range },
        orderBy: { createdAt: "asc" },
        include: { customer: { select: { id: true, displayName: true } } },
      }),
    ]);
    entries.push(
      ...receiptEntries(
        [
          ...payments.map((p) => ({
            piece: p.number,
            date: day(p.receivedAt),
            method: p.method as PaymentMethodLike,
            customerName: p.customer?.displayName ?? "",
            customerAccount: p.customer ? thirdParty(p.customer.id) : "",
            amount: p.amount,
            reference: p.reference,
          })),
          ...refunds.map((r) => ({
            piece: `RMB-${r.id.slice(-6).toUpperCase()}`,
            date: day(r.createdAt),
            method: r.method as PaymentMethodLike,
            customerName: r.customer.displayName,
            customerAccount: thirdParty(r.customer.id),
            amount: r.amount,
            reference: r.reference,
            isRefund: true,
          })),
        ],
        accounts,
      ),
    );
  }
  if (wants("CA")) {
    const [expenses, drops] = await Promise.all([
      // RG-M08-30 : seules les dépenses validées sont des sorties de caisse.
      tenantDb.expense.findMany({
        where: { paidAt: range, status: "APPROVED" },
        orderBy: { paidAt: "asc" },
      }),
      tenantDb.cashDrop.findMany({ where: { createdAt: range }, orderBy: { createdAt: "asc" } }),
    ]);
    entries.push(
      ...cashEntries(
        expenses.map((e) => ({
          piece: `DEP-${e.id.slice(-6).toUpperCase()}`,
          date: day(e.paidAt),
          category: e.category,
          description: e.description,
          amount: e.amount,
        })),
        drops.map((d) => ({
          piece: `VER-${d.id.slice(-6).toUpperCase()}`,
          date: day(d.createdAt),
          amount: d.amount,
          destination: d.destination === "bank" ? ("bank" as const) : ("safe" as const),
        })),
        accounts,
      ),
    );
  }
  const totals = assertBalanced(entries);
  return {
    fileName: `syscohada_${input.journal}_${input.from}_${input.to}.csv`,
    csv: syscohadaCsv(entries),
    entries,
    debit: totals.debit,
    credit: totals.credit,
    count: entries.length,
  };
}

export const accountingRouter = router({
  export: requirePermission("accounting:export")
    .input(accountingExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await buildAccountingExport(tenantDb, org, input);
      return { ...result, entries: result.entries.slice(0, 200) };
    }),
});
