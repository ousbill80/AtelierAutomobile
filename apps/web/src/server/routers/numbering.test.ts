import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);
const currentYear = new Date().getFullYear();

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

describe("numbering router (M15 étape 1.2, RG-M15-06/RG-M15-12)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Numérotation A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Numérotation B" } });

    const userA = await adminDb.user.create({
      data: {
        name: "Owner Numérotation A",
        email: `${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: orgA.id, userId: userA.id, role: "OWNER", siteIds: [] },
    });
    const tokenA = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: userA.id,
        token: tokenA,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: orgA.id,
        isPinSession: false,
      },
    });
    ownerA = { userId: userA.id, token: tokenA };

    const userB = await adminDb.user.create({
      data: {
        name: "Owner Numérotation B",
        email: `${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: userB.id, role: "OWNER", siteIds: [] },
    });
    const tokenB = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: userB.id,
        token: tokenB,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: orgB.id,
        isPinSession: false,
      },
    });
    ownerB = { userId: userB.id, token: tokenB };
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.documentSequence.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.site.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({
      where: { userId: { in: [ownerA.userId, ownerB.userId] } },
    });
    await adminDb.membership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("numbering.get renvoie les 9 formats par défaut avec un aperçu du prochain numéro", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.numbering.get();
    expect(result).toHaveLength(9);

    const fac = result.find((r) => r.docType === "FAC")!;
    expect(fac.config.padding).toBe(6);
    expect(fac.config.perSite).toBe(false);
    expect(fac.nextPreview).toBe(`FAC-${currentYear}-000001`);
  });

  it("numbering.update personnalise le préfixe et le padding d'une facture (US-M15-06)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const updated = await caller.numbering.update({
      docType: "FAC",
      prefix: "F",
      pattern: "{TYPE}-{AAAA}-{N}",
      padding: 4,
      perSite: false,
      resetYearly: true,
    });
    expect(updated.nextPreview).toBe(`F-${currentYear}-0001`);

    const refetched = await caller.numbering.get();
    const fac = refetched.find((r) => r.docType === "FAC")!;
    expect(fac.config.prefix).toBe("F");
    expect(fac.config.padding).toBe(4);
  });

  it("numbering.update refuse de faire baisser la valeur de départ (RG-M15-06)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await adminDb.documentSequence.create({
      data: { organizationId: orgA.id, docType: "FAC", year: currentYear, lastValue: 10 },
    });

    await expect(
      caller.numbering.update({
        docType: "FAC",
        prefix: "F",
        pattern: "{TYPE}-{AAAA}-{N}",
        padding: 4,
        perSite: false,
        resetYearly: true,
        startAt: 5,
      }),
    ).rejects.toThrow(/doit être supérieure/);
  });

  it("numbering.update applique la valeur de départ sans séquence existante (remise annuelle)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const updated = await caller.numbering.update({
      docType: "AV",
      prefix: "AV",
      pattern: "{TYPE}-{AAAA}-{N}",
      padding: 6,
      perSite: false,
      resetYearly: true,
      startAt: 120,
    });
    expect(updated.nextValue).toBe(120);
    expect(updated.nextPreview).toBe(`AV-${currentYear}-000120`);
    const seq = await adminDb.documentSequence.findFirst({
      where: { organizationId: orgA.id, docType: "AV", year: currentYear, siteId: null },
    });
    expect(seq?.lastValue).toBe(119);
  });

  it("numbering.update applique la valeur de départ par site sans remise annuelle (year = 0)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const sites = await Promise.all(
      ["NUMA", "NUMB"].map((code) =>
        adminDb.site.create({ data: { organizationId: orgA.id, name: `Site ${code}`, code } }),
      ),
    );
    await adminDb.documentSequence.create({
      data: { organizationId: orgA.id, siteId: sites[0]!.id, docType: "OR", year: 0, lastValue: 7 },
    });
    const input = {
      docType: "OR" as const,
      prefix: "OR",
      pattern: "{TYPE}-{SITE}-{N}",
      padding: 5,
      perSite: true,
      resetYearly: false,
    };

    await expect(caller.numbering.update({ ...input, startAt: 7 })).rejects.toThrow(
      /doit être supérieure/,
    );

    const updated = await caller.numbering.update({ ...input, startAt: 50 });
    expect(updated.nextValue).toBe(50);
    const seqs = await adminDb.documentSequence.findMany({
      where: { organizationId: orgA.id, docType: "OR", year: 0 },
    });
    expect(seqs).toHaveLength(2);
    expect(seqs.every((seq) => seq.lastValue === 49)).toBe(true);

    const refetched = await caller.numbering.get();
    expect(refetched.find((r) => r.docType === "OR")!.nextValue).toBe(50);
  });

  it("numbering.update refuse une facture numérotée par site (RG-M15-12, document fiscal — A4)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.numbering.update({
        docType: "FAC",
        prefix: "F",
        pattern: "{TYPE}-{AAAA}-{N}",
        padding: 4,
        perSite: true,
        resetYearly: true,
      }),
    ).rejects.toThrow(/par organisation/);
  });

  it("isolation multi-locataire : la config d'une organisation n'affecte pas une autre", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const result = await callerB.numbering.get();
    const fac = result.find((r) => r.docType === "FAC")!;
    expect(fac.config.prefix).toBe("FAC");
    expect(fac.config.padding).toBe(6);
  });
});
