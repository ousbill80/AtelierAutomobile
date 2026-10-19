import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function membershipContextFor(
  organizationId: string,
  name: string,
  options: { role?: "OWNER" | "ADVISOR"; siteIds?: string[] } = {},
) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role: options.role ?? "OWNER",
      siteIds: options.siteIds ?? [],
    },
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
  return { userId: user.id, membershipId: membership.id, token };
}

describe("search router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };
  let customerA: { id: string };
  let vehicleA: { id: string };
  let siteOne: { id: string };
  let siteTwo: { id: string };
  let orSiteOne: { id: string; number: string };
  let orSiteTwo: { id: string; number: string };
  let restrictedToSiteOne: { userId: string; membershipId: string; token: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Recherche A", plan: "PRO" } });
    ownerA = await membershipContextFor(orgA.id, "Owner Recherche A");
    userIds.push(ownerA.userId);

    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "INDIVIDUAL",
        lastName: "Kouassi",
        displayName: "Kouassi Amani",
        phone: "+2250708123987",
      },
    });
    vehicleA = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        plate: "1234 AB 01",
        plateCompact: "1234AB01",
        plateType: "STANDARD",
        make: "Toyota",
        model: "Corolla",
        usage: "PRIVATE",
      },
    });

    siteOne = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site Un", code: "SU1" },
    });
    siteTwo = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site Deux", code: "SU2" },
    });
    orSiteOne = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteOne.id,
        number: "OR-SU1-2026-00001",
        customerId: customerA.id,
        vehicleId: vehicleA.id,
        status: "DRAFT",
      },
    });
    orSiteTwo = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteTwo.id,
        number: "OR-SU2-2026-00002",
        customerId: customerA.id,
        vehicleId: vehicleA.id,
        status: "DRAFT",
      },
    });

    restrictedToSiteOne = await membershipContextFor(orgA.id, "Conseiller Site Un", {
      role: "ADVISOR",
      siteIds: [siteOne.id],
    });
    userIds.push(restrictedToSiteOne.userId);

    orgB = await adminDb.organization.create({ data: { name: "Garage Recherche B", plan: "PRO" } });
    ownerB = await membershipContextFor(orgB.id, "Owner Recherche B");
    userIds.push(ownerB.userId);
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.repairOrder.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("search.global trouve un client par suffixe de téléphone (RG-M02-19)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "0708123987" });
    expect(result.customers.map((c) => c.id)).toContain(customerA.id);
  });

  it("search.global trouve un véhicule par plaque (ILIKE puis trigram)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "1234 AB 01" });
    expect(result.vehicles.map((v) => v.id)).toContain(vehicleA.id);
  });

  it("search.global trouve un OR par son numéro (préfixe document)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "OR-SU1-2026" });
    expect(result.documents.map((d) => d.number)).toContain(orSiteOne.number);
  });

  it("search.global trouve un client par similarité de nom (trigram, sans accents)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "kouasi amani" });
    expect(result.customers.map((c) => c.id)).toContain(customerA.id);
  });

  it("search.global limite les documents aux sites autorisés (RG-M01-09)", async () => {
    const restrictedCaller = callerFactory(await contextFor(restrictedToSiteOne.token));
    const result = await restrictedCaller.search.global({ q: "OR-SU" });
    const numbers = result.documents.map((d) => d.number);
    expect(numbers).toContain(orSiteOne.number);
    expect(numbers).not.toContain(orSiteTwo.number);
  });

  it("search.global isole les résultats par organisation", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const result = await callerB.search.global({ q: "1234 AB 01" });
    expect(result.vehicles.map((v) => v.id)).not.toContain(vehicleA.id);

    const resultPhone = await callerB.search.global({ q: "0708123987" });
    expect(resultPhone.customers.map((c) => c.id)).not.toContain(customerA.id);
  });
});
