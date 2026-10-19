// US-M07-07 — GET /api/achats/{id}/pdf : bon de commande fournisseur en PDF (téléchargement ou
// partage manuel). Session + permission `purchase:read` + portée site vérifiées côté serveur.
import { formatDate, valueOf } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { renderPurchaseOrderPdf } from "@atelieros/pdf";
import { createContext } from "@/server/context";

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
  if (!ctx.permissions.has("purchase:read")) {
    return error(403, "Permission manquante : purchase:read");
  }
  const po = await db.forTenant({ organizationId }).purchaseOrder.findFirst({
    where: { id },
    include: {
      supplier: true,
      site: true,
      lines: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!po) return error(404, "Bon de commande introuvable.");
  if (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(po.siteId)) {
    return error(403, "Site non autorisé.");
  }
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, legalName: true, address: true, ncc: true, timezone: true },
  });
  const buffer = await renderPurchaseOrderPdf({
    garage: org,
    site: { name: po.site.name, address: po.site.address, phone: po.site.phone },
    supplier: {
      name: po.supplier.name,
      phone: po.supplier.whatsappPhone ?? po.supplier.phone,
      email: po.supplier.email,
      address: po.supplier.address,
    },
    number: po.number,
    orderedAt: po.orderedAt ? formatDate(po.orderedAt, org.timezone) : null,
    expectedAt: po.expectedAt ? formatDate(po.expectedAt, "UTC") : null,
    notes: po.notes,
    total: po.total,
    lines: po.lines.map((l) => ({
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      quantity: l.quantity,
      quantityScale: l.product.quantityScale,
      unitCost: l.unitCost,
      total: valueOf(l.quantity, l.product.quantityScale, l.unitCost),
    })),
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${po.number}.pdf"`,
    },
  });
}
