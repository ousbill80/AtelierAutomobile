import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { createPortalLink, resetRateLimits } from "@atelieros/planning";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function publicContext(ip = "203.0.113.10") {
  const req = new Request("http://localhost/api/trpc", { headers: { "x-forwarded-for": ip } });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

const HOURS = {
  mon: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  tue: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  wed: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  thu: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  fri: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ],
  sat: [["08:00", "14:00"]],
  sun: [],
};

describe("portal.appointment (US-M03-06, US-M03-07)", () => {
  let orgId: string;
  let siteId: string;
  let customerId: string;
  let vehicleId: string;
  let bookingToken: string;

  beforeAll(async () => {
    const org = await adminDb.organization.create({
      data: {
        name: `Garage Portail ${randomBytes(2).toString("hex")}`,
        timezone: "Africa/Abidjan",
      },
    });
    orgId = org.id;
    const site = await adminDb.site.create({
      data: {
        organizationId: orgId,
        name: "Site P",
        code: "SP",
        openingHours: HOURS,
        phone: "+2250708000000",
      },
    });
    siteId = site.id;
    await adminDb.bay.create({
      data: { organizationId: orgId, siteId, name: "Pont 1", type: "LIFT" },
    });
    const user = await adminDb.user.create({
      data: { name: "Méca", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    await adminDb.membership.create({
      data: { organizationId: orgId, userId: user.id, role: "MECHANIC", siteIds: [] },
    });
    const customer = await adminDb.customer.create({
      data: {
        organizationId: orgId,
        displayName: "Traoré Awa",
        civility: "MME",
        lastName: "Traoré",
        phone: "+2250101010101",
        hasWhatsapp: true,
      },
    });
    customerId = customer.id;
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgId,
        customerId,
        plate: "1234 AB 01",
        plateCompact: "1234AB01",
        make: "Peugeot",
        model: "208",
      },
    });
    vehicleId = vehicle.id;
    const link = await createPortalLink({
      organizationId: orgId,
      scope: "BOOKING",
      targetId: vehicleId,
      customerId,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    bookingToken = link.token;
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: orgId } });
    await adminDb.notification.deleteMany({ where: { organizationId: orgId } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: orgId } });
    await adminDb.portalToken.deleteMany({ where: { organizationId: orgId } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: orgId } });
    await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: orgId } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgId } });
    const memberships = await adminDb.membership.findMany({ where: { organizationId: orgId } });
    await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
    await adminDb.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
    await adminDb.bay.deleteMany({ where: { organizationId: orgId } });
    await adminDb.site.deleteMany({ where: { organizationId: orgId } });
    await adminDb.organization.delete({ where: { id: orgId } });
  });

  beforeEach(() => {
    defaultOutbox.clear();
    resetRateLimits();
  });

  it("affiche le garage et le véhicule pré-identifié sans données d'autres clients", async () => {
    const caller = callerFactory(await publicContext());
    const view = await caller.portal.appointment.get({ token: bookingToken });
    expect(view.scope).toBe("BOOKING");
    expect(view.vehicle?.label).toBe("Peugeot 208 (1234 AB 01)");
    expect(view.customer.displayName).toBe("Traoré Awa");
    expect(view.portalTypes).toContain("SERVICE");
  });

  it("propose au plus 6 créneaux par demi-journée sur 14 jours, puis réserve en CONFIRMED et envoie le message", async () => {
    const caller = callerFactory(await publicContext());
    const slots = await caller.portal.appointment.slots({ token: bookingToken, type: "SERVICE" });
    expect(slots.days.length).toBeGreaterThan(0);
    expect(slots.days.every((d) => d.slots.length <= 6)).toBe(true);
    const slot = slots.days[0]!.slots[0]!;
    const booked = await caller.portal.appointment.book({
      token: bookingToken,
      startsAt: slot.startsAt,
      type: "SERVICE",
    });
    expect(booked.status).toBe("CONFIRMED");
    const stored = await adminDb.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    expect(stored.source).toBe("PORTAL");
    expect(stored.vehicleId).toBe(vehicleId);
    expect(stored.siteId).toBe(siteId);
    expect(defaultOutbox.lastFor("+2250101010101")?.body).toContain("Bonjour Mme Traoré");
  });

  it("un créneau pris entre-temps renvoie « Ce créneau vient d'être réservé »", async () => {
    const caller = callerFactory(await publicContext("203.0.113.11"));
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgId, source: "PORTAL" },
    });
    const otherCustomer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "Autre Client", phone: "+2250202020202" },
    });
    const otherLink = await createPortalLink({
      organizationId: orgId,
      scope: "BOOKING",
      targetId: otherCustomer.id,
      customerId: otherCustomer.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    // Même véhicule → doublon du jour.
    await expect(
      caller.portal.appointment.book({
        token: bookingToken,
        startsAt: existing.startsAt,
        type: "SERVICE",
      }),
    ).rejects.toThrow("Ce véhicule a déjà un RDV");
    // Pont unique occupé par le RDV existant + affectation automatique → le créneau n'est plus proposé.
    const bay = await adminDb.bay.findFirstOrThrow({ where: { siteId } });
    await adminDb.appointment.update({ where: { id: existing.id }, data: { bayId: bay.id } });
    await adminDb.organization.update({
      where: { id: orgId },
      data: { settings: { appointments: { autoAssignBay: true } } },
    });
    await expect(
      caller.portal.appointment.book({
        token: otherLink.token,
        startsAt: existing.startsAt,
        type: "SERVICE",
      }),
    ).rejects.toThrow("Ce créneau vient d'être réservé");
    await adminDb.organization.update({ where: { id: orgId }, data: { settings: {} } });
    await adminDb.appointment.update({ where: { id: existing.id }, data: { bayId: null } });
  });

  it("jeton APPOINTMENT : confirmer, déplacer, annuler ; jeton expiré refusé", async () => {
    const existing = await adminDb.appointment.findFirstOrThrow({
      where: { organizationId: orgId, source: "PORTAL" },
    });
    await adminDb.appointment.update({
      where: { id: existing.id },
      data: { status: "BOOKED", confirmedAt: null, confirmedVia: null },
    });
    const link = await createPortalLink({
      organizationId: orgId,
      scope: "APPOINTMENT",
      targetId: existing.id,
      customerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const caller = callerFactory(await publicContext("203.0.113.12"));
    const confirmed = await caller.portal.appointment.confirm({ token: link.token });
    expect(confirmed.status).toBe("CONFIRMED");

    const slots = await caller.portal.appointment.slots({ token: link.token });
    const later = slots.days
      .flatMap((d) => d.slots)
      .find((s) => s.startsAt.getTime() !== existing.startsAt.getTime())!;
    const moved = await caller.portal.appointment.reschedule({
      token: link.token,
      startsAt: later.startsAt,
    });
    expect(moved.startsAt.getTime()).toBe(later.startsAt.getTime());
    expect(defaultOutbox.lastFor("+2250101010101")?.body).toContain("a été déplacé");

    const cancelled = await caller.portal.appointment.cancel({ token: link.token });
    expect(cancelled.status).toBe("CANCELLED");
    const stored = await adminDb.appointment.findUniqueOrThrow({ where: { id: existing.id } });
    expect(stored.cancelledBy).toBe("CUSTOMER");

    const expired = await createPortalLink({
      organizationId: orgId,
      scope: "BOOKING",
      targetId: vehicleId,
      customerId,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(caller.portal.appointment.get({ token: expired.token })).rejects.toThrow(
      "Ce lien a expiré",
    );
    await expect(caller.portal.appointment.get({ token: "A".repeat(43) })).rejects.toThrow(
      "n'est pas valide",
    );
  });

  it("limite les réservations : 3 RDV futurs actifs par client via le portail", async () => {
    const link = await createPortalLink({
      organizationId: orgId,
      scope: "BOOKING",
      targetId: customerId,
      customerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const caller = callerFactory(await publicContext("203.0.113.13"));
    const slots = await caller.portal.appointment.slots({ token: link.token, type: "TIRES" });
    const candidates = slots.days.flatMap((d) => d.slots);
    const picked = [
      candidates[0]!,
      candidates[candidates.length - 1]!,
      slots.days[Math.floor(slots.days.length / 2)]!.slots[0]!,
    ];
    for (const slot of picked) {
      resetRateLimits();
      await caller.portal.appointment.book({
        token: link.token,
        startsAt: slot.startsAt,
        type: "TIRES",
      });
    }
    resetRateLimits();
    await expect(
      caller.portal.appointment.book({
        token: link.token,
        startsAt: candidates[1]!.startsAt,
        type: "TIRES",
      }),
    ).rejects.toThrow("Vous avez déjà 3 RDV");
  });
});
