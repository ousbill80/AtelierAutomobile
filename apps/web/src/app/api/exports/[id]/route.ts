// M15 RG-M15-21 — GET /api/exports/{id} : téléchargement de l'archive de l'export complet.
// Session + `settings:billing` + organisation active vérifiées, lien valable 48 h, puis
// redirection vers une URL S3 signée de courte durée (5 min). Chaque téléchargement est audité.
import { isExportExpired } from "@atelieros/core";
import { db, writeAuditLog } from "@atelieros/db";
import { createContext } from "@/server/context";
import { getObjectStorage } from "@/server/storage";

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has("settings:billing")) {
    return error(403, "Permission manquante : settings:billing");
  }
  const tenantDb = db.forTenant({ organizationId });
  const row = await tenantDb.dataExport.findFirst({ where: { id } });
  if (!row || row.status !== "READY" || !row.fileUrl) {
    return error(404, "Archive introuvable ou pas encore prête.");
  }
  if (isExportExpired(row.expiresAt, new Date())) {
    return error(410, "Lien expiré (48 h) : relancez un export depuis Paramètres > Données.");
  }
  await writeAuditLog({
    organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    action: "org.export_downloaded",
    entity: "DataExport",
    entityId: row.id,
    reason: "Téléchargement de l'archive d'export complet.",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  const fileName = `atelieros-export-${row.createdAt.toISOString().slice(0, 10)}.zip`;
  const url = await getObjectStorage().getSignedDownloadUrl(row.fileUrl, 300, fileName);
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "private, no-store" },
  });
}
