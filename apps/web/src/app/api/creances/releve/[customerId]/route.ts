// RG-M09-15 — GET /api/creances/releve/{customerId}?from=AAAA-MM-JJ&to=AAAA-MM-JJ : relevé
// de compte PDF. Session + permission `receivable:read` vérifiées côté serveur.
import { businessDate, statementFileName } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { renderStatementPdf } from "@atelieros/pdf";
import { createContext } from "@/server/context";
import { receivablesNow } from "@/server/receivables/helpers";
import { buildCustomerStatement } from "@/server/routers/collections";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has("receivable:read")) {
    return error(403, "Permission manquante : receivable:read");
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return error(400, "Période invalide : indiquez from et to au format AAAA-MM-JJ.");
  }

  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, legalName: true, address: true, rccm: true, ncc: true, timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const today = businessDate(receivablesNow(), org.timezone);
  let statement;
  try {
    statement = await buildCustomerStatement(
      tenantDb,
      customerId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T00:00:00.000Z`),
      today,
    );
  } catch {
    return error(404, "Client introuvable.");
  }

  const pdf = await renderStatementPdf({
    garage: org,
    customer: statement.customer,
    from: statement.from,
    to: statement.to,
    openingBalance: statement.openingBalance,
    closingBalance: statement.closingBalance,
    totalDebit: statement.totalDebit,
    totalCredit: statement.totalCredit,
    lines: statement.lines,
    aging: statement.aging,
    openInvoices: statement.openInvoices,
  });
  const fileName = statementFileName(statement.customer.displayName, today);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
