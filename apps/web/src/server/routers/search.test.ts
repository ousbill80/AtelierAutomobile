import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";
import { searchCustomers, searchVehicles } from "../customers/trigram";

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
  let companyA: { id: string };
  let vehicleA: { id: string };
  let vehicleVin: { id: string };
  let siteOne: { id: string };
  let siteTwo: { id: string };
  let orSiteOne: { id: string; number: string };
  let orSiteTwo: { id: string; number: string };
  let creditNote: { id: string };
  let receipt: { id: string };
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
    // Un homonyme partiel : « Kouassi Amani » doit passer devant (préfixe > similarité).
    await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "INDIVIDUAL",
        displayName: "Amani Kouassi Junior",
      },
    });
    companyA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        companyName: "SOTRA Logistique SARL",
        displayName: "SOTRA Logistique SARL",
        phone: "+2252720000000",
      },
    });
    await adminDb.customerContact.create({
      data: {
        organizationId: orgA.id,
        customerId: companyA.id,
        name: "Diabaté Moussa",
        role: "Responsable flotte",
        phone: "+2250501020304",
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
        driverPhone: "+2250101556677",
      },
    });
    vehicleVin = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: companyA.id,
        plate: "SANS PLAQUE",
        plateCompact: "SANSPLAQUE",
        plateType: "NONE",
        vin: "JTDBR32E720123456",
        fleetNumber: "FLOTTE-17",
        make: "Toyota",
        model: "Hilux",
        usage: "UTILITY",
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
    creditNote = await adminDb.invoice.create({
      data: {
        organizationId: orgA.id,
        siteId: siteOne.id,
        customerId: customerA.id,
        type: "CREDIT_NOTE",
        number: "AV-2026-000007",
      },
    });
    receipt = await adminDb.payment.create({
      data: {
        organizationId: orgA.id,
        siteId: siteOne.id,
        customerId: customerA.id,
        number: "REC-2026-000310",
        method: "CASH",
        amount: 15000,
        receivedAt: new Date(),
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
    await adminDb.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.repairOrder.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customerContact.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("trouve un client par suffixe de téléphone, saisi avec espaces (RG-M02-19)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "07 08 12 39 87" });
    expect(result.customers.map((c) => c.id)).toContain(customerA.id);
  });

  it("trouve l'entreprise par le téléphone d'un de ses contacts", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "0501020304" });
    const hit = result.customers.find((c) => c.id === companyA.id);
    expect(hit?.matchedContactName).toBe("Diabaté Moussa");
  });

  it("trouve un véhicule par le téléphone du chauffeur", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "0101556677" });
    expect(result.vehicles.map((v) => v.id)).toContain(vehicleA.id);
  });

  it("trouve un véhicule par plaque, exacte en tête", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "1234 ab 01" });
    expect(result.vehicles[0]?.id).toBe(vehicleA.id);
    expect(result.vehicles[0]?.rank).toBe(3);
    expect(result.vehicles[0]?.customerDisplayName).toBe("Kouassi Amani");
  });

  it("tolère la confusion 0/O et 1/I dans la plaque (RG-M02-05)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "I234 AB OI" });
    expect(result.vehicles.map((v) => v.id)).toContain(vehicleA.id);
  });

  it("trouve un véhicule par VIN ou numéro de flotte", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const byVin = await caller.search.global({ q: "JTDBR32E72012" });
    expect(byVin.vehicles.map((v) => v.id)).toContain(vehicleVin.id);
    const byFleet = await caller.search.global({ q: "flotte-17" });
    expect(byFleet.vehicles.map((v) => v.id)).toContain(vehicleVin.id);
  });

  it("trouve un OR par son numéro (préfixe document)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "OR-SU1-2026" });
    expect(result.documents.map((d) => d.number)).toContain(orSiteOne.number);
    expect(result.documents[0]?.type).toBe("repair_order");
  });

  it("trouve un avoir (AV-) et un reçu (REC-) par leur numéro", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const av = await caller.search.global({ q: "AV-2026-000007" });
    expect(av.documents).toEqual([
      expect.objectContaining({ id: creditNote.id, type: "credit_note", rank: 3 }),
    ]);
    const rec = await caller.search.global({ q: "rec-2026" });
    expect(rec.documents.map((d) => d.id)).toContain(receipt.id);
  });

  it("un nombre seul cherche aussi dans les numéros de document", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "00002" });
    expect(result.documents.map((d) => d.number)).toContain(orSiteTwo.number);
  });

  it("trouve un client par similarité de nom (trigram, sans accents) et classe le préfixe en tête", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const fuzzy = await caller.search.global({ q: "kouasi amani" });
    expect(fuzzy.customers.map((c) => c.id)).toContain(customerA.id);
    const prefix = await caller.search.global({ q: "Kouassi" });
    expect(prefix.customers[0]?.id).toBe(customerA.id);
  });

  it("trouve l'entreprise par le nom d'un contact, accents ignorés", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.search.global({ q: "diabate" });
    const hit = result.customers.find((c) => c.id === companyA.id);
    expect(hit?.matchedContactName).toBe("Diabaté Moussa");
  });

  it("limite les documents aux sites autorisés (RG-M01-09)", async () => {
    const restrictedCaller = callerFactory(await contextFor(restrictedToSiteOne.token));
    const result = await restrictedCaller.search.global({ q: "OR-SU" });
    const numbers = result.documents.map((d) => d.number);
    expect(numbers).toContain(orSiteOne.number);
    expect(numbers).not.toContain(orSiteTwo.number);
  });

  it("isole les résultats par organisation", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const byPlate = await callerB.search.global({ q: "1234 AB 01" });
    expect(byPlate.vehicles).toEqual([]);
    const byPhone = await callerB.search.global({ q: "0708123987" });
    expect(byPhone.customers).toEqual([]);
    const byName = await callerB.search.global({ q: "Kouassi" });
    expect(byName.customers).toEqual([]);
    const byDocument = await callerB.search.global({ q: "OR-SU1" });
    expect(byDocument.documents).toEqual([]);
    const byContact = await callerB.search.global({ q: "Diabaté" });
    expect(byContact.customers).toEqual([]);
  });

  it("façades searchVehicles/searchCustomers (réception M04) : plaque partielle, téléphone, isolation", async () => {
    expect((await searchVehicles(orgA.id, "1234", 8)).map((v) => v.id)).toContain(vehicleA.id);
    expect((await searchVehicles(orgA.id, "flotte-17", 8)).map((v) => v.id)).toContain(
      vehicleVin.id,
    );
    expect((await searchCustomers(orgA.id, "07 08 12 39 87", 8)).map((c) => c.id)).toContain(
      customerA.id,
    );
    expect((await searchCustomers(orgA.id, "Kouassi", 8))[0]?.id).toBe(customerA.id);
    expect(await searchVehicles(orgB.id, "1234", 8)).toEqual([]);
    expect(await searchCustomers(orgB.id, "Kouassi", 8)).toEqual([]);
  });

  it("refuse une requête de moins de 2 caractères", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(caller.search.global({ q: "a" })).rejects.toThrow();
  });
});
