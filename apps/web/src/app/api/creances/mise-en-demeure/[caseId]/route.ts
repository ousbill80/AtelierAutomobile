// M09 RG-M09-16 — GET /api/creances/mise-en-demeure/{caseId} : aperçu / téléchargement de la
// mise en demeure (PDF). Session + permission `receivable:formal_notice` vérifiées côté serveur.
import { businessDate } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { createContext } from "@/server/context";
import { receivablesNow } from "@/server/receivables/helpers";
import { buildFormalNotice, renderFormalNotice } from "@/server/receivables/formalNotice";

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has("receivable:formal_notice")) {
    return error(403, "Permission manquante : seul le gérant peut préparer une mise en demeure.");
  }
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  try {
    const notice = await buildFormalNotice(
      db.forTenant({ organizationId }),
      organizationId,
      caseId,
      businessDate(receivablesNow(), org.timezone),
    );
    const pdf = await renderFormalNotice(notice.data);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${notice.fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (cause) {
    return error(404, cause instanceof Error ? cause.message : "Dossier introuvable.");
  }
}
