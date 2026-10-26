// M18 §8 — GET /api/tresorerie/rapport?from&to&accountId&groupBy&format=csv|pdf : rapport de
// trésorerie d'une période (RG-M18-08). Session + `treasury:read`.
import { TRPCError } from "@trpc/server";
import { formatFCFA, toCsv } from "@atelieros/core";
import { db } from "@atelieros/db";
import { renderReportPdf } from "@atelieros/pdf";
import { treasuryReportInputSchema } from "@atelieros/validators";
import { createContext } from "@/server/context";
import type { OrgCtx } from "@/server/billing/context";
import { loadOrgBillingContext } from "@/server/billing/service";
import { buildTreasuryReport, prepareTreasury } from "@/server/routers/treasury";

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const frDate = (key: string) => key.split("-").reverse().join("/");
const GROUP_LABEL = { day: "Jour", week: "Semaine du", month: "Mois" } as const;

function periodLabel(key: string, groupBy: "day" | "week" | "month") {
  return groupBy === "month" ? `${key.slice(5, 7)}/${key.slice(0, 4)}` : frDate(key);
}

export async function GET(req: Request) {
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership)
    return error(401, "Session invalide ou expirée.");
  if (!ctx.permissions.has("treasury:read"))
    return error(403, "Permission manquante : treasury:read");
  const url = new URL(req.url);
  const parsed = treasuryReportInputSchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    accountId: url.searchParams.get("accountId") || undefined,
    groupBy: url.searchParams.get("groupBy") || undefined,
  });
  if (!parsed.success)
    return error(400, parsed.error.issues[0]?.message ?? "Paramètres invalides.");
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const input = parsed.data;
  const org = await loadOrgBillingContext(organizationId);
  const tenantDb = db.forTenant({ organizationId });
  const orgCtx = { ...ctx, organizationId } as OrgCtx;
  let report: Awaited<ReturnType<typeof buildTreasuryReport>>;
  try {
    report = await tenantDb.transaction(async (tx) => {
      await prepareTreasury(tx, orgCtx, org);
      return buildTreasuryReport(tx, org, input);
    });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") return error(404, e.message);
    throw e;
  }
  const scope = report.accountName ?? "Tous les comptes";
  const filename = `tresorerie-${input.from}-${input.to}.${format}`;
  const rows = report.series.map((s) => ({
    period: periodLabel(s.key, input.groupBy),
    inflow: s.inflow,
    outflow: s.outflow,
    net: s.net,
  }));

  if (format === "csv") {
    const csv = toCsv(
      [GROUP_LABEL[input.groupBy], "Entrées", "Sorties", "Net"],
      [
        ...rows.map((r) => [r.period, r.inflow, r.outflow, r.net]),
        ["Total", report.inflow, report.outflow, report.net],
        [],
        ["Solde d'ouverture", report.opening],
        ["Solde de clôture", report.closing],
        [],
        ["Compte", "Ouverture", "Entrées", "Sorties", "Clôture"],
        ...report.accounts.map((a) => [a.name, a.opening, a.inflow, a.outflow, a.closing]),
      ],
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const pdf = await renderReportPdf({
    garage: { name: org.name, legalName: org.legalName, ncc: org.ncc },
    title: "Trésorerie",
    params: [
      `Période : du ${frDate(input.from)} au ${frDate(input.to)}`,
      `Comptes : ${scope}`,
      `Solde d'ouverture : ${formatFCFA(report.opening)} — solde de clôture : ${formatFCFA(report.closing)}`,
    ],
    columns: [
      { key: "period", label: GROUP_LABEL[input.groupBy], numeric: false },
      { key: "inflow", label: "Entrées", numeric: true },
      { key: "outflow", label: "Sorties", numeric: true },
      { key: "net", label: "Net", numeric: true },
    ],
    rows: rows.map((r) => ({
      period: r.period,
      inflow: formatFCFA(r.inflow),
      outflow: formatFCFA(r.outflow),
      net: formatFCFA(r.net),
    })),
    totals: {
      inflow: formatFCFA(report.inflow),
      outflow: formatFCFA(report.outflow),
      net: formatFCFA(report.net),
    },
    totalLabel: "Total",
    notes: [
      ...report.accounts.map(
        (a) =>
          `${a.name} : ouverture ${formatFCFA(a.opening)}, entrées ${formatFCFA(a.inflow)}, sorties ${formatFCFA(a.outflow)}, clôture ${formatFCFA(a.closing)}`,
      ),
      ...(report.accountName
        ? []
        : ["Virements internes et versements de caisse exclus des totaux."]),
    ],
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
