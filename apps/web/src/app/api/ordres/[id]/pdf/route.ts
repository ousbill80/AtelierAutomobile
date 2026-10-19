// US-M04-15 — GET /api/ordres/{id}/pdf?kind=reception|workshop|full|delivery : documents de
// l'OR. Session + `repair_order:read` + portée par site ; prix uniquement sur l'OR complet.
import { CHECK_IN_ITEM_KEYS, isCountedLine, lineAmounts, repairOrderTotals } from "@atelieros/core";
import { db } from "@atelieros/db";
import { renderRepairOrderPdf, type RepairOrderPdfKind } from "@atelieros/pdf";
import fr from "../../../../../../messages/fr.json";
import { createContext } from "@/server/context";
import { loadOrgRoContext } from "@/server/repairOrders/helpers";
import { getAttachmentStorage } from "@/server/storage";

const KINDS = new Set<RepairOrderPdfKind>(["reception", "workshop", "full", "delivery"]);
const FILE_LABEL: Record<RepairOrderPdfKind, string> = {
  reception: "bon-de-reception",
  workshop: "fiche-atelier",
  full: "ordre-de-reparation",
  delivery: "bon-de-restitution",
};

function error(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function dataUri(key: string, mimeType: string): Promise<string | null> {
  // react-pdf ne lit que PNG/JPEG : les photos WebP ne sont pas incrustées (comptées seulement).
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(key);
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  const organizationId = ctx.session?.activeOrganizationId;
  if (!ctx.user || !organizationId || !ctx.membership) {
    return error(401, "Session invalide ou expirée.");
  }
  if (!ctx.permissions.has("repair_order:read")) {
    return error(403, "Permission manquante : repair_order:read");
  }
  const kind = (new URL(req.url).searchParams.get("kind") ?? "full") as RepairOrderPdfKind;
  if (!KINDS.has(kind)) return error(400, "Type de document inconnu.");

  const tenantDb = db.forTenant({ organizationId });
  const order = await tenantDb.repairOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: true,
      vehicle: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { assignedTo: { select: { user: { select: { name: true } } } } },
      },
    },
  });
  if (!order || (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(order.siteId))) {
    return error(404, "Ordre de réparation introuvable.");
  }
  const org = await loadOrgRoContext(organizationId);
  const attachments = await tenantDb.attachment.findMany({
    where: { entity: "repair_order", entityId: order.id },
    orderBy: { createdAt: "asc" },
  });
  const checkIn = (order.checkIn ?? {}) as Record<string, unknown>;
  const itemLabels = fr.repairOrders.checkInItems as Record<string, string>;
  const items = ((checkIn.items as { key: string; present: boolean }[]) ?? []).filter((i) =>
    (CHECK_IN_ITEM_KEYS as readonly string[]).includes(i.key),
  );
  const photos = attachments.filter((a) => a.kind === "photo_checkin" || a.kind === "photo_damage");
  const signatures = attachments.filter((a) => a.kind === "signature");
  const photoUris = (await Promise.all(photos.map((p) => dataUri(p.url, p.mimeType)))).filter(
    (u): u is string => !!u,
  );
  const receptionSignature = signatures[0];
  const deliverySignature = order.deliverySignatureUrl
    ? signatures.find((s) => order.deliverySignatureUrl?.endsWith(s.id))
    : undefined;
  const checkOut = checkIn.checkOut as
    | {
        mileage: number | null;
        fuelLevel: number;
        itemsConfirmed: boolean;
        oldPartsReturned: boolean;
        collectedBy: { name: string; phone?: string };
        at: string;
      }
    | undefined;
  const lines = order.lines.filter((l) => isCountedLine(l));
  const totals = repairOrderTotals(order.lines, org.vatEnabled);
  const signatureStatus = checkIn.signatureRefused
    ? `Le client a refusé de signer (constaté par ${String(checkIn.signatureRefusedBy ?? "le réceptionnaire")}).`
    : checkIn.remoteSignaturePending
      ? "Signature à distance en attente."
      : order.signedAt
        ? `Signé le ${order.signedAt.toISOString().slice(0, 10).split("-").reverse().join("/")}.`
        : "Non signé.";

  const pdf = await renderRepairOrderPdf({
    kind,
    garage: {
      name: org.name,
      address: org.address,
      phone: org.phone,
      rccm: org.rccm,
      ncc: org.ncc,
    },
    number: order.number,
    createdAt: order.createdAt.toISOString(),
    promisedAt: order.promisedAt?.toISOString() ?? null,
    customer: { displayName: order.customer.displayName, phone: order.customer.phone },
    vehicle: {
      plate: order.vehicle.plate,
      make: order.vehicle.make,
      model: order.vehicle.model,
      year: order.vehicle.year,
    },
    mileageIn: order.mileageIn,
    fuelLevel: order.fuelLevel,
    complaint: order.complaint,
    diagnosis: order.diagnosis,
    damages: (checkIn.damages as never[]) ?? [],
    noDamage: Boolean(checkIn.noDamage),
    items: items.map((i) => ({ label: itemLabels[i.key] ?? i.key, present: i.present })),
    keysCount: (checkIn.keysCount as number) ?? null,
    belongings: (checkIn.belongings as string) ?? null,
    warningLights: (checkIn.warningLights as string[]) ?? [],
    authorizationCeiling: (checkIn.authorizationCeiling as number) ?? 0,
    returnOldParts: Boolean(checkIn.returnOldParts),
    lines: lines.map((l) => ({
      type: l.type,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.type === "PART" && l.isCustomerSupplied ? 0 : l.unitPrice,
      discountRate: l.discountRate,
      total: lineAmounts(l, org.vatEnabled).total,
      approval: l.approval,
      mechanic: l.assignedTo?.user.name ?? null,
      isCustomerSupplied: l.isCustomerSupplied,
    })),
    totals: { subtotal: totals.subtotal, vatTotal: totals.vatTotal, total: totals.total },
    signature: {
      status: signatureStatus,
      signerName: (checkIn.signerName as string) ?? null,
      image: receptionSignature
        ? await dataUri(receptionSignature.url, receptionSignature.mimeType)
        : null,
    },
    photos: photoUris,
    photoCount: photos.length,
    checkOut: checkOut
      ? {
          mileage: checkOut.mileage,
          fuelLevel: checkOut.fuelLevel,
          itemsConfirmed: checkOut.itemsConfirmed,
          oldPartsReturned: checkOut.oldPartsReturned,
          collectedBy: [checkOut.collectedBy.name, checkOut.collectedBy.phone]
            .filter(Boolean)
            .join(" — "),
          at: checkOut.at,
          signatureImage: deliverySignature
            ? await dataUri(deliverySignature.url, deliverySignature.mimeType)
            : null,
        }
      : null,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${FILE_LABEL[kind]}-${order.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
