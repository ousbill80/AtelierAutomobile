import { randomBytes } from "node:crypto";
import { adminDb, buildDigestForMembership, db } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanOrganizationAlerts } from "./alertsScan";

// M12 partie 2 (étape 6.1) — alertes credit_limit, discount_high, stock_below_min et lignes
// « HIER / OR / AUJOURD'HUI » du résumé quotidien en mode FULL. Horloge figée.
const NOW = new Date("2026-10-19T08:00:00Z");

describe("M12 partie 2 — alertes calculées et résumé FULL", () => {
  let org: { id: string };
  let owner: { id: string };
  let storekeeper: { id: string };
  const users: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: `Garage Alertes ${randomBytes(2).toString("hex")}` },
    });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const mk = async (role: "OWNER" | "STOREKEEPER") => {
      const user = await adminDb.user.create({
        data: { name: role, email: `${randomBytes(5).toString("hex")}@example.com` },
      });
      users.push(user.id);
      return adminDb.membership.create({
        data: { organizationId: org.id, userId: user.id, role, siteIds: [] },
      });
    };
    owner = await mk("OWNER");
    storekeeper = await mk("STOREKEEPER");
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "SOTRA Logistique", creditLimit: 1_000_000 },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        number: "FAC-ALR-1",
        status: "ISSUED",
        issuedAt: new Date("2026-10-18T15:00:00Z"),
        dueDate: new Date("2026-11-18T00:00:00Z"),
        subtotal: 1_050_000,
        total: 1_239_000,
        balance: 1_239_000,
        lines: {
          create: [
            {
              organizationId: org.id,
              type: "PART",
              description: "Kit embrayage",
              quantity: 1,
              unitPrice: 1_312_500,
              discountRate: 20,
              vatRate: 18,
              lineSubtotal: 1_050_000,
              lineVat: 189_000,
              lineTotal: 1_239_000,
            },
          ],
        },
      },
    });
    await adminDb.payment.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        number: "REC-ALR-1",
        method: "WAVE",
        amount: 520_000,
        receivedAt: new Date("2026-10-18T11:00:00Z"),
      },
    });
    const product = await adminDb.product.create({
      data: { organizationId: org.id, sku: "FH-01", name: "Filtre à huile" },
    });
    await adminDb.domainEvent.create({
      data: {
        organizationId: org.id,
        type: "stock.below_minimum",
        payload: { productId: product.id, siteId: site.id, projected: 2, minStock: 5 },
        occurredAt: new Date("2026-10-19T07:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    const where = { where: { organizationId: org.id } };
    await adminDb.domainEvent.deleteMany(where);
    await adminDb.payment.deleteMany(where);
    await adminDb.invoiceLine.deleteMany(where);
    await adminDb.invoice.deleteMany(where);
    await adminDb.product.deleteMany(where);
    await adminDb.customer.deleteMany(where);
    await adminDb.notification.deleteMany(where);
    await adminDb.membership.deleteMany(where);
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany(where);
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("crée credit_limit, discount_high (OWNER) et stock_below_min (STOREKEEPER), une fois par jour", async () => {
    await scanOrganizationAlerts(org.id, NOW);
    const ownerTypes = (
      await adminDb.notification.findMany({ where: { membershipId: owner.id } })
    ).map((n) => n.type);
    expect(ownerTypes.sort()).toEqual(["alert.credit_limit", "alert.discount_high"]);
    const stock = await adminDb.notification.findMany({ where: { membershipId: storekeeper.id } });
    expect(stock.map((n) => [n.type, n.title])).toEqual([
      ["alert.stock_below_min", "Stock sous le minimum — Filtre à huile"],
    ]);
    expect(await scanOrganizationAlerts(org.id, NOW)).toBe(0);
  });

  it("résumé FULL : CA et encaissements d'hier, mêmes définitions que le tableau de bord", async () => {
    const text = await buildDigestForMembership(
      db.forTenant({ organizationId: org.id }),
      { id: org.id, name: "Garage Alertes", timezone: "Africa/Abidjan", operatingMode: "FULL" },
      { id: owner.id, siteIds: [] },
      NOW,
      "http://localhost:3000/tableau-de-bord",
    );
    expect(text).toContain("HIER : CA 1 050 000 FCFA HT · encaissé 520 000 FCFA (Wave 520 000)");
    expect(text).toContain("ARGENT DEHORS : 1 239 000 FCFA");
  });
});
