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

async function ownerContextFor(organizationId: string, name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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

describe("segment router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };

  const userIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Segments A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Segments A");
    userIds.push(ownerA.userId);

    orgB = await adminDb.organization.create({ data: { name: "Garage Segments B", plan: "PRO" } });
    ownerB = await ownerContextFor(orgB.id, "Owner Segments B");
    userIds.push(ownerB.userId);

    await adminDb.customer.createMany({
      data: [
        {
          organizationId: orgA.id,
          type: "INDIVIDUAL",
          lastName: "Entreprise",
          displayName: "Client Entreprise A",
          tags: ["flotte"],
        },
        {
          organizationId: orgA.id,
          type: "INDIVIDUAL",
          lastName: "Particulier",
          displayName: "Client Particulier A",
          tags: [],
        },
      ],
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customerSegment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("segment.create crée un segment et journalise segment.created", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const segment = await caller.segment.create({
      name: "Flotte entreprises",
      filters: { tags: ["flotte"] },
    });
    expect(segment.name).toBe("Flotte entreprises");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "segment.created", entityId: segment.id },
    });
    expect(log).not.toBeNull();
  });

  it("segment.list isole les segments par organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));
    const created = await callerA.segment.create({ name: "Liste A", filters: {} });

    const listA = await callerA.segment.list();
    expect(listA.map((s) => s.id)).toContain(created.id);

    const listB = await callerB.segment.list();
    expect(listB.map((s) => s.id)).not.toContain(created.id);
  });

  it("segment.update modifie le nom et les filtres", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.segment.create({ name: "Avant", filters: { optedOut: false } });
    const updated = await caller.segment.update({
      id: created.id,
      name: "Après",
      filters: { optedOut: true },
    });
    expect(updated.name).toBe("Après");
    expect((updated.filters as { optedOut?: boolean }).optedOut).toBe(true);
  });

  it("segment.delete supprime le segment", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.segment.create({ name: "À supprimer", filters: {} });
    const result = await caller.segment.delete({ id: created.id });
    expect(result.ok).toBe(true);

    await expect(
      adminDb.customerSegment.findUniqueOrThrow({ where: { id: created.id } }),
    ).rejects.toThrow();
  });

  it("segment.preview compte et échantillonne les clients correspondant aux filtres", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const preview = await caller.segment.preview({ filters: { tags: ["flotte"] } });
    expect(preview.count).toBeGreaterThanOrEqual(1);
    expect(preview.sample.every((c) => c.tags.includes("flotte"))).toBe(true);
  });
});
