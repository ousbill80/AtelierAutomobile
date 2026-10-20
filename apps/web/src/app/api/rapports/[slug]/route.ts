// M12 §7/§8 — GET /api/rapports/{slug}?format=xlsx|pdf|csv&from=&to=&asOf=&siteId=&groupBy=
// Export d'un rapport (synchrone, 100 000 lignes au plus, §11). Session + permission du rapport
// vérifiées côté serveur, site intersecté avec `Membership.siteIds`, export journalisé
// (`AuditLog` action `report.export`, §10).
import { isReportSlug, MAX_EXPORT_ROWS, reportFileName, REPORTS } from "@atelieros/core";
import { db, writeAuditLog } from "@atelieros/db";
import { reportFiltersSchema } from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { createContext } from "@/server/context";
import { buildReport } from "@/server/reports/builders";
import { loadOrgReportContext, reportsNow, resolveSiteScope } from "@/server/reports/context";
import { toCsvText, toPdf, toXlsx } from "@/server/reports/export";
import { RL } from "@/server/reports/labels";

const FORMATS = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
} as const;
type Format = keyof typeof FORMATS;

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isReportSlug(slug)) return error(404, "Rapport introuvable.");
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has(REPORTS[slug].permission)) return error(403, RL.export.forbidden);

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "xlsx";
  if (!(format in FORMATS)) return error(400, "Format inconnu : choisissez xlsx, pdf ou csv.");
  const parsed = reportFiltersSchema.safeParse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    asOf: url.searchParams.get("asOf") || undefined,
    siteId: url.searchParams.get("siteId") || undefined,
    groupBy: url.searchParams.get("groupBy") || undefined,
  });
  if (!parsed.success) {
    return error(400, parsed.error.issues[0]?.message ?? "Filtres invalides.");
  }
  const filters = parsed.data;
  let scope;
  try {
    scope = resolveSiteScope(ctx, filters.siteId);
  } catch (e) {
    if (e instanceof TRPCError) return error(403, e.message);
    throw e;
  }

  const tenantDb = db.forTenant({ organizationId });
  const org = await loadOrgReportContext(organizationId);
  const now = reportsNow();
  const result = await buildReport(
    slug,
    {
      t: tenantDb,
      organizationId,
      org,
      scope,
      filters,
      now,
      financial: ctx.permissions.has("report:financial"),
    },
    { offset: 0, limit: MAX_EXPORT_ROWS + 1 },
  );
  if (result.rows.length > MAX_EXPORT_ROWS) return error(413, RL.export.tooMany);

  const site = filters.siteId
    ? await tenantDb.site.findFirst({ where: { id: filters.siteId }, select: { name: true } })
    : null;
  const meta = { slug, org, siteName: site?.name ?? null, userName: ctx.user.name, now };
  const body =
    format === "xlsx"
      ? await toXlsx(result, meta)
      : format === "pdf"
        ? await toPdf(result, meta)
        : new TextEncoder().encode(toCsvText(result));
  const fileName = reportFileName({
    slug,
    from: result.period.from,
    to: result.period.to,
    asOf: result.period.asOf,
    site: site?.name ?? null,
    format: format as Format,
  });

  await writeAuditLog({
    organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    siteId: filters.siteId ?? null,
    action: "report.export",
    entity: "Report",
    entityId: slug,
    after: { format, filters, rowCount: result.rows.length, fileName },
  });

  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": FORMATS[format as Format],
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
