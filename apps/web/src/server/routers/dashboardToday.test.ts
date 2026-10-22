import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function callerFor(
  organizationId: string,
  role: "OWNER" | "MANAGER" | "ADVISOR" | "CASHIER" | "MECHANIC",
  siteIds: string[] = [],
) {
  const user = await adminDb.user.create({
    data: { name: `Today ${role}`, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { caller: callerFactory(ctx), membership };
}

const DAY = 24 * 60 * 60 * 1000;
const hex = () => randomBytes(3).toString("hex");
/** Date métier (minuit UTC) à `days` jours d'aujourd'hui (Abidjan = UTC). */
const businessDay = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

describe("dashboard.today — onglet « Aujourd'hui »", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteA1: { id: string };
  let siteA2: { id: string };
  let ownerA: Awaited<ReturnType<typeof callerFor>>;
  let ownerB: Awaited<ReturnType<typeof callerFor>>;

  beforeAll(async () => {
    orgA = await adminDb.organization.create({
      data: { name: "Garage Aujourd'hui A", timezone: "Africa/Abidjan" },
    });
    orgB = await adminDb.organization.create({ data: { name: "Garage Aujourd'hui B" } });
    siteA1 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: `Y${hex()}` },
    });
    siteA2 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Cocody", code: `C${hex()}` },
    });
    ownerA = await callerFor(orgA.id, "OWNER");
    ownerB = await callerFor(orgB.id, "OWNER");

    const customer = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Mme Koné",
        type: "INDIVIDUAL",
        phone: "+2250707000001",
      },
    });
    const vehicle = (plate: string, inspectionDays: number | null) =>
      adminDb.vehicle.create({
        data: {
          organizationId: orgA.id,
          customerId: customer.id,
          plate,
          plateCompact: plate.replace(/\s/g, ""),
          make: "Renault",
          model: "Duster",
          inspectionExpiryDate: inspectionDays === null ? null : businessDay(inspectionDays),
        },
      });
    const v1 = await vehicle(`6074 AB ${hex()}`, 8);
    const v2 = await vehicle(`1832 EF ${hex()}`, 25);
    const v3 = await vehicle(`8450 GH ${hex()}`, 45);
    await vehicle(`9999 ZZ ${hex()}`, 90); // hors horizon de 60 jours

    const insurer = await adminDb.insuranceCompany.create({
      data: { organizationId: orgA.id, name: "Assurance Baobab" },
    });
    const claim = await adminDb.insuranceClaim.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA1.id,
        number: `SIN-${hex()}`,
        insuranceCompanyId: insurer.id,
        customerId: customer.id,
        vehicleId: v1.id,
        status: "APPROVED",
        approvedAmount: 450_000,
      },
    });

    const ro = (vehicleId: string, siteId: string, status: string, claimId?: string) =>
      adminDb.repairOrder.create({
        data: {
          organizationId: orgA.id,
          siteId,
          number: `OR-${hex()}`,
          customerId: customer.id,
          vehicleId,
          status: status as never,
          promisedAt: new Date(Date.now() + DAY),
          insuranceClaimId: claimId ?? null,
        },
      });
    await ro(v1.id, siteA1.id, "IN_PROGRESS", claim.id);
    await ro(v2.id, siteA1.id, "READY");
    await ro(v3.id, siteA2.id, "CHECKED_IN");
    await ro(v3.id, siteA2.id, "DELIVERED"); // hors atelier

    await adminDb.invoice.createMany({
      data: [
        {
          organizationId: orgA.id,
          siteId: siteA1.id,
          customerId: customer.id,
          number: `FAC-${hex()}`,
          status: "OVERDUE",
          issuedAt: new Date(Date.now() - 40 * DAY),
          dueDate: businessDay(-19),
          total: 320_000,
          balance: 320_000,
        },
        {
          organizationId: orgA.id,
          siteId: siteA2.id,
          customerId: customer.id,
          number: `FAC-${hex()}`,
          status: "ISSUED",
          issuedAt: new Date(Date.now() - 2 * DAY),
          dueDate: businessDay(10),
          total: 95_000,
          balance: 95_000,
        },
      ],
    });

    await adminDb.payment.createMany({
      data: [
        {
          organizationId: orgA.id,
          siteId: siteA1.id,
          customerId: customer.id,
          number: `REC-${hex()}`,
          method: "CASH",
          amount: 215_000,
          receivedAt: new Date(),
        },
        {
          organizationId: orgA.id,
          siteId: siteA2.id,
          customerId: customer.id,
          number: `REC-${hex()}`,
          method: "WAVE",
          amount: 85_000,
          receivedAt: new Date(),
        },
        {
          organizationId: orgA.id,
          siteId: siteA1.id,
          customerId: customer.id,
          number: `REC-${hex()}`,
          method: "ORANGE_MONEY",
          amount: 120_000,
          receivedAt: new Date(Date.now() - 3 * DAY),
        },
      ],
    });
  });

  it("calcule les blocs du jour pour le propriétaire", async () => {
    const res = await ownerA.caller.dashboard.today({ period: "today" });

    expect(res.workshop?.total).toBe(3);
    expect(res.workshop?.stages).toEqual({ checkedIn: 1, diagnosis: 0, repair: 1, ready: 1 });
    const insured = res.workshop?.items.find((i) => i.status === "IN_PROGRESS");
    expect(insured).toMatchObject({ insurerName: "Assurance Baobab", stage: "repair" });
    expect(res.workshop?.items.find((i) => i.status === "READY")?.insurerName).toBeNull();

    expect(res.cash?.total).toBe(300_000);
    expect(res.cash?.paymentsCount).toBe(2);
    expect(res.cash?.byMethod).toMatchObject({ CASH: 215_000, WAVE: 85_000 });
    expect(res.cash?.daily).toHaveLength(7);
    expect(res.cash?.daily.at(-1)).toEqual({ day: res.today, total: 300_000 });
    expect(res.cash?.daily.reduce((s, d) => s + d.total, 0)).toBe(420_000);

    expect(res.unpaid).toMatchObject({
      total: 415_000,
      count: 2,
      overdueCount: 1,
      longOverdueCount: 1,
    });
    expect(res.unpaid?.overdue[0]).toMatchObject({ balance: 320_000, daysOverdue: 19 });

    expect(res.inspections?.total).toBe(3);
    expect(res.inspections?.bands).toEqual({ j15: 1, j30: 1, j60: 1 });
    expect(res.inspections?.items[0]).toMatchObject({ daysLeft: 8, band: "j15", followUp: "none" });

    expect(res.reminders).toMatchObject({ sentThisWeek: 0, toApprove: 0, upcoming: [] });
    expect(res.claims?.total).toBe(450_000);
    expect(res.claims?.stages.approved).toEqual({ count: 1, amount: 450_000 });
  });

  it("filtre site : blocs du site seulement, VT masquées (véhicules sans site)", async () => {
    const res = await ownerA.caller.dashboard.today({ period: "today", siteId: siteA2.id });
    expect(res.workshop?.total).toBe(1);
    expect(res.cash?.total).toBe(85_000);
    expect(res.unpaid?.total).toBe(95_000);
    expect(res.claims?.total).toBe(0);
    expect(res.inspections).toBeNull();

    const restricted = await callerFor(orgA.id, "OWNER", [siteA2.id]);
    await expect(
      restricted.caller.dashboard.today({ period: "today", siteId: siteA1.id }),
    ).rejects.toThrow("Vous n'avez pas accès à ce site.");
  });

  it("isolation multi-locataire : l'organisation B ne voit rien de A", async () => {
    const res = await ownerB.caller.dashboard.today({ period: "today" });
    expect(res.workshop?.total).toBe(0);
    expect(res.cash?.total).toBe(0);
    expect(res.unpaid?.total).toBe(0);
    expect(res.inspections?.total).toBe(0);
    expect(res.claims?.total).toBe(0);
  });

  it("permissions : MECHANIC refusé ; chaque bloc suit la permission du module", async () => {
    const mechanic = await callerFor(orgA.id, "MECHANIC");
    await expect(mechanic.caller.dashboard.today({ period: "today" })).rejects.toThrow(
      /mécaniciens/,
    );
    // CASHIER : caisse, créances et sinistres, mais pas les relances.
    const cashier = await callerFor(orgA.id, "CASHIER");
    const res = await cashier.caller.dashboard.today({ period: "today" });
    expect(res.cash).not.toBeNull();
    expect(res.claims).not.toBeNull();
    expect(res.inspections).toBeNull();
    expect(res.reminders).toBeNull();
  });
});
