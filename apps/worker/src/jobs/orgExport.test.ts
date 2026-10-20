import { strFromU8, unzipSync } from "fflate";
import { fixedClock } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@atelieros/pdf";
import { processExportsSweep, runOrgExport, type ExportStorage } from "./orgExport";

// M15 §12 — export complet : toutes les tables, aucune donnée d'une autre organisation.

class MemoryStorage implements ExportStorage {
  readonly objects = new Map<string, Uint8Array>();
  async upload(input: { key: string; body: Uint8Array }) {
    this.objects.set(input.key, input.body);
    return { key: input.key };
  }
  async getObjectBytes(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`absent: ${key}`);
    return bytes;
  }
}

const NOW = new Date("2026-10-20T10:00:00.000Z");
const orgIds: string[] = [];
const userIds: string[] = [];

interface Fixture {
  orgId: string;
  membershipId: string;
  marker: string;
  invoiceNumber: string;
}

async function seedOrg(label: string, storage: MemoryStorage): Promise<Fixture> {
  const marker = `${label}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await adminDb.organization.create({
    data: { name: `Garage Export ${marker}`, onboardingCompletedAt: NOW },
  });
  orgIds.push(org.id);
  const user = await adminDb.user.create({
    data: { name: `Gérant ${marker}`, email: `${marker}@example.com` },
  });
  userIds.push(user.id);
  const membership = await adminDb.membership.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: "OWNER",
      siteIds: [],
      pinHash: `pinhash-${marker}`,
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: org.id, name: `Atelier ${marker}`, code: "ABJ" },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: org.id,
      displayName: `Client ${marker}`,
      phone: "+2250701020304",
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      plate: "1234 AB 01",
      plateCompact: "1234AB01",
      make: "Toyota",
      model: `Corolla ${marker}`,
    },
  });
  await adminDb.channelConfig.create({
    data: {
      organizationId: org.id,
      channel: "SMS",
      provider: "twilio",
      credentials: `v1:SECRET-${marker}`,
    },
  });
  const photoKey = `attachments/${org.id}/photo.jpg`;
  storage.objects.set(photoKey, new Uint8Array([0xff, 0xd8, 0xff]));
  await adminDb.attachment.create({
    data: {
      organizationId: org.id,
      entity: "vehicle",
      entityId: vehicle.id,
      kind: "photo_checkin",
      url: photoKey,
      mimeType: "image/jpeg",
      size: 3,
    },
  });
  const invoiceNumber = `FAC-2026-${label === "A" ? "000001" : "000002"}`;
  const invoice = await adminDb.invoice.create({
    data: {
      organizationId: org.id,
      siteId: site.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      number: invoiceNumber,
      status: "ISSUED",
      issuedAt: NOW,
      subtotal: 15_000,
      vatTotal: 2_700,
      total: 17_700,
      balance: 17_700,
    },
  });
  await adminDb.invoiceLine.create({
    data: {
      organizationId: org.id,
      invoiceId: invoice.id,
      type: "LABOR",
      description: `Vidange ${marker}`,
      quantity: 1,
      unitPrice: 15_000,
      vatRate: 18,
      lineSubtotal: 15_000,
      lineVat: 2_700,
      lineTotal: 17_700,
    },
  });
  return { orgId: org.id, membershipId: membership.id, marker, invoiceNumber };
}

describe("org.export (RG-M15-21)", () => {
  const storage = new MemoryStorage();
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await seedOrg("A", storage);
    b = await seedOrg("B", storage);
  });

  afterAll(async () => {
    await deleteTestOrganizations(orgIds, userIds);
  });

  it("produit une archive complète de l'organisation, sans aucune ligne d'une autre", async () => {
    const exportRow = await adminDb.dataExport.create({
      data: { organizationId: a.orgId, requestedById: a.membershipId },
    });
    const rendered: string[] = [];
    await runOrgExport(
      { organizationId: a.orgId, exportId: exportRow.id },
      {
        storage,
        clock: fixedClock(NOW),
        renderInvoicePdf: async (data) => {
          rendered.push(data.number ?? "");
          return new TextEncoder().encode(`%PDF ${data.number}`);
        },
      },
    );

    const row = await adminDb.dataExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    expect(row.status).toBe("READY");
    expect(row.expiresAt?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(row.fileUrl).toBe(`exports/${a.orgId}/${exportRow.id}.zip`);

    const files = unzipSync(storage.objects.get(row.fileUrl!)!);
    const names = Object.keys(files);
    expect(names).toEqual(
      expect.arrayContaining([
        "customer.csv",
        "vehicle.csv",
        "invoice.csv",
        "invoice_line.csv",
        "membership.csv",
        "channel_config.csv",
        "user.csv",
        "LISEZMOI.txt",
        `documents/${a.invoiceNumber}.pdf`,
      ]),
    );
    expect(names.some((n) => n.startsWith("photos/vehicle-"))).toBe(true);
    expect(rendered).toEqual([a.invoiceNumber]);

    const customerCsv = strFromU8(files["customer.csv"]!);
    expect([...files["customer.csv"]!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    expect(customerCsv).toContain(`Client ${a.marker}`);

    // Isolation : ni l'identifiant ni les marqueurs de l'organisation B n'apparaissent nulle part.
    const everything = names.map((n) => strFromU8(files[n]!, true)).join("\n");
    expect(everything).not.toContain(b.orgId);
    expect(everything).not.toContain(b.marker);
    for (const name of names.filter((n) => n.endsWith(".csv"))) {
      const csv = strFromU8(files[name]!);
      const [header, ...lines] = csv
        .replace(/^\uFEFF/, "")
        .trim()
        .split("\r\n");
      const orgCol = header!.split(";").indexOf("organizationId");
      if (orgCol < 0) continue;
      for (const line of lines.filter(Boolean)) {
        expect(line).toContain(a.orgId);
      }
    }

    // Secrets et empreintes jamais exportés.
    expect(everything).not.toContain(`SECRET-${a.marker}`);
    expect(everything).not.toContain(`pinhash-${a.marker}`);
    expect(strFromU8(files["channel_config.csv"]!)).not.toContain("credentials");

    const notification = await adminDb.notification.findFirst({
      where: { organizationId: a.orgId, membershipId: a.membershipId, type: "export.ready" },
    });
    expect(notification?.link).toBe("/parametres/donnees");
  });

  it("est idempotent et reprend un export resté PENDING", async () => {
    const pending = await adminDb.dataExport.create({
      data: {
        organizationId: b.orgId,
        requestedById: b.membershipId,
        createdAt: new Date(NOW.getTime() - 10 * 60_000),
      },
    });
    await processExportsSweep({ storage, clock: fixedClock(NOW) });
    const row = await adminDb.dataExport.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.status).toBe("READY");
    const before = storage.objects.size;
    await runOrgExport({ organizationId: b.orgId, exportId: pending.id }, { storage });
    expect(storage.objects.size).toBe(before);
  });

  it("rend les factures émises en PDF avec le moteur réel (documents/)", async () => {
    const exportRow = await adminDb.dataExport.create({
      data: { organizationId: a.orgId, requestedById: a.membershipId },
    });
    await runOrgExport(
      { organizationId: a.orgId, exportId: exportRow.id },
      { storage, renderInvoicePdf: async (data) => new Uint8Array(await renderInvoicePdf(data)) },
    );
    const row = await adminDb.dataExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    const files = unzipSync(storage.objects.get(row.fileUrl!)!);
    const pdf = files[`documents/${a.invoiceNumber}.pdf`]!;
    expect(strFromU8(pdf.slice(0, 4))).toBe("%PDF");
  });
});
