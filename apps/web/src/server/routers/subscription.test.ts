import { createHash, randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as downloadExport } from "../../app/api/exports/[id]/route";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M15 étape 6.5 — plans et limites (US-M15-07, RG-M15-19/20), export complet (US-M15-08,
// RG-M15-21), suppression programmée (US-M15-09, RG-M15-22), accès support (RG-M15-27).

// Pas de Redis dans ce fichier : l'export reste PENDING (repris par `exports.sweep` du worker).
delete process.env.REDIS_URL;

const callerFactory = createCallerFactory(appRouter);
const orgIds: string[] = [];
const userIds: string[] = [];

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function caller(token: string) {
  return callerFactory(await contextFor(token));
}

async function member(organizationId: string, role: "OWNER" | "ADVISOR" | "MANAGER") {
  const user = await adminDb.user.create({
    data: { name: `${role} test`, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  userIds.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
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
  return { user, membership, token };
}

async function newOrg(name: string) {
  const org = await adminDb.organization.create({
    data: { name, onboardingCompletedAt: new Date() },
  });
  orgIds.push(org.id);
  await adminDb.site.create({ data: { organizationId: org.id, name: "Yopougon", code: "YOP" } });
  return org;
}

/** Le provider `console` ne persiste que le hash : retrouvé par force brute (6 chiffres). */
async function latestSecurityCode(email: string): Promise<string> {
  const row = await adminDb.verification.findFirstOrThrow({
    where: { identifier: `${email}:SENSITIVE_ACTION` },
    orderBy: { createdAt: "desc" },
  });
  for (let i = 0; i < 1_000_000; i++) {
    const code = i.toString().padStart(6, "0");
    if (createHash("sha256").update(code).digest("hex") === row.value) return code;
  }
  throw new Error("code introuvable");
}

async function freshCode(token: string, email: string) {
  await adminDb.verification.deleteMany({ where: { identifier: `${email}:SENSITIVE_ACTION` } });
  await (await caller(token)).org.sendSecurityCode();
  return latestSecurityCode(email);
}

function domainCode(error: unknown): string | null | undefined {
  const cause = (error as TRPCError).cause as { code?: string } | undefined;
  return cause?.code;
}

afterAll(async () => {
  await deleteTestOrganizations(orgIds, userIds);
});

describe("plan (US-M15-07, RG-M15-19/20)", () => {
  let org: { id: string };
  let owner: Awaited<ReturnType<typeof member>>;
  let advisor: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    org = await newOrg("Garage Plan");
    owner = await member(org.id, "OWNER");
    advisor = await member(org.id, "ADVISOR");
  });

  beforeEach(() => {
    delete process.env.SUBSCRIPTION_BILLING_PROVIDER;
  });

  it("plan.get renvoie les jauges d'usage du plan STARTER", async () => {
    const result = await (await caller(owner.token)).plan.get();
    expect(result.plan).toBe("STARTER");
    const gauge = (key: string) => result.gauges.find((g) => g.key === key);
    expect(gauge("activeSites")).toMatchObject({ used: 1, limit: 1, level: "REACHED" });
    expect(gauge("activeMembers")).toMatchObject({ used: 2, limit: 5, level: "OK" });
    expect(gauge("autoMessagesPerMonth")).toMatchObject({ used: 0, limit: 1_000 });
    expect(result.catalog.map((p) => p.tier)).toEqual(["STARTER", "PRO", "NETWORK"]);
  });

  it("refuse plan.* à un ADVISOR (settings:billing)", async () => {
    await expect((await caller(advisor.token)).plan.get()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("applique la limite de sites côté serveur avec le message de M15", async () => {
    const error = await (
      await caller(owner.token)
    ).site
      .create({ name: "Cocody", code: "COC" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).message).toBe(
      "Votre offre STARTER permet 1 site. Passez à l'offre PRO.",
    );
    expect(domainCode(error)).toBe("PLAN_LIMIT_REACHED");
  });

  it("manual : la demande part à l'équipe commerciale, le plan ne change pas", async () => {
    const result = await (
      await caller(owner.token)
    ).plan.requestChange({
      targetPlan: "PRO",
      message: "Deuxième atelier à Cocody",
    });
    expect(result).toMatchObject({ status: "PENDING", plan: "STARTER" });
    const after = await (await caller(owner.token)).plan.get();
    expect(after.plan).toBe("STARTER");
    expect(after.pendingRequest?.targetPlan).toBe("PRO");
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "plan.change_requested" },
    });
    expect(audit?.reason).toBe("Deuxième atelier à Cocody");
  });

  it("fake : le changement est appliqué, la limite est levée ; la rétrogradation liste l'impact", async () => {
    process.env.SUBSCRIPTION_BILLING_PROVIDER = "fake";
    const result = await (await caller(owner.token)).plan.requestChange({ targetPlan: "PRO" });
    expect(result).toMatchObject({ status: "APPLIED", plan: "PRO" });
    await (await caller(owner.token)).site.create({ name: "Cocody", code: "COC" });
    expect((await (await caller(owner.token)).plan.get()).pendingRequest).toBeNull();

    const downgrade = await (
      await caller(owner.token)
    ).plan.requestChange({
      targetPlan: "STARTER",
    });
    expect(downgrade.downgradeImpact).toEqual([
      { key: "activeSites", used: 2, limit: 1, excess: 1 },
    ]);
    // Rien n'est supprimé.
    expect(await adminDb.site.count({ where: { organizationId: org.id, isActive: true } })).toBe(2);
    await expect(
      (await caller(owner.token)).plan.requestChange({ targetPlan: "STARTER" }),
    ).rejects.toThrow("Vous êtes déjà sur l'offre STARTER.");
  });
});

describe("export complet (US-M15-08, RG-M15-21)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: Awaited<ReturnType<typeof member>>;
  let ownerB: Awaited<ReturnType<typeof member>>;
  let exportId: string;

  beforeAll(async () => {
    orgA = await newOrg("Garage Export A");
    orgB = await newOrg("Garage Export B");
    ownerA = await member(orgA.id, "OWNER");
    ownerB = await member(orgB.id, "OWNER");
  });

  it("exige un OTP frais du demandeur", async () => {
    await expect(
      (await caller(ownerA.token)).dataExport.request({ otp: "000000" }),
    ).rejects.toThrow(/Demandez d'abord un code|Code incorrect/);
  });

  it("crée l'export, l'audite, puis limite à un export par 24 h", async () => {
    const code = await freshCode(ownerA.token, ownerA.user.email!);
    const { exportId: id } = await (await caller(ownerA.token)).dataExport.request({ otp: code });
    exportId = id;
    const row = await adminDb.dataExport.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "PENDING", requestedById: ownerA.membership.id });
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "org.export", entityId: id },
    });
    expect(audit?.reason).toContain("OTP");

    const second = await freshCode(ownerA.token, ownerA.user.email!);
    await expect((await caller(ownerA.token)).dataExport.request({ otp: second })).rejects.toThrow(
      /moins de 24 h/,
    );
  });

  it("dataExport.list ne renvoie ni la clé S3 ni les exports d'une autre organisation", async () => {
    await adminDb.dataExport.update({
      where: { id: exportId },
      data: {
        status: "READY",
        fileUrl: `exports/${orgA.id}/${exportId}.zip`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const list = await (await caller(ownerA.token)).dataExport.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: exportId, status: "READY", downloadable: true });
    expect(JSON.stringify(list)).not.toContain("exports/");
    expect(await (await caller(ownerB.token)).dataExport.list()).toEqual([]);
  });

  it("GET /api/exports/{id} redirige vers une URL signée, audite, et refuse une autre organisation", async () => {
    const request = (token: string) =>
      new Request(`http://localhost/api/exports/${exportId}`, {
        headers: { cookie: `atelieros_session=${token}` },
      });
    const params = { params: Promise.resolve({ id: exportId }) };
    const ok = await downloadExport(request(ownerA.token), params);
    expect(ok.status).toBe(302);
    const location = ok.headers.get("location") ?? "";
    expect(location).toContain(`exports/${orgA.id}/${exportId}.zip`);
    expect(location).toContain("X-Amz-Signature");
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "org.export_downloaded" },
      }),
    ).toBe(1);

    const other = await downloadExport(request(ownerB.token), params);
    expect(other.status).toBe(404);

    await adminDb.dataExport.update({
      where: { id: exportId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await downloadExport(request(ownerA.token), params)).status).toBe(410);
  });
});

describe("suppression du compte (US-M15-09, RG-M15-22) et accès support (RG-M15-27)", () => {
  let org: { id: string; name: string };
  let owner: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    org = await newOrg("Garage Excellence Suppression");
    owner = await member(org.id, "OWNER");
  });

  it("refuse un nom de garage incorrect", async () => {
    const code = await freshCode(owner.token, owner.user.email!);
    await expect(
      (await caller(owner.token)).org.requestDeletion({ confirmName: "Autre garage", otp: code }),
    ).rejects.toThrow(/Saisissez exactement le nom du garage/);
  });

  it("programme la suppression à J+30 : lecture seule, export et annulation possibles", async () => {
    const code = await freshCode(owner.token, owner.user.email!);
    const before = Date.now();
    const { scheduledFor } = await (
      await caller(owner.token)
    ).org.requestDeletion({
      confirmName: "garage excellence suppression",
      otp: code,
      reason: "Fermeture de l'atelier",
    });
    const days = (scheduledFor.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const stored = await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(stored.lifecycleStatus).toBe("DELETION_SCHEDULED");

    // Lecture seule : les mutations ordinaires sont refusées, les lectures passent.
    await expect(
      (await caller(owner.token)).site.create({ name: "Cocody", code: "COC" }),
    ).rejects.toThrow(/lecture seule/);
    await expect((await caller(owner.token)).plan.get()).resolves.toBeTruthy();
    // L'export reste possible.
    const exportCode = await freshCode(owner.token, owner.user.email!);
    await expect(
      (await caller(owner.token)).dataExport.request({ otp: exportCode }),
    ).resolves.toHaveProperty("exportId");

    await (await caller(owner.token)).org.cancelDeletion();
    const restored = await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(restored).toMatchObject({ lifecycleStatus: "ACTIVE", deletionScheduledFor: null });
    const actions = (
      await adminDb.auditLog.findMany({
        where: { organizationId: org.id },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["org.deletion_requested", "org.deletion_cancelled", "org.export"]),
    );
    await expect((await caller(owner.token)).org.cancelDeletion()).rejects.toThrow(
      "Aucune suppression n'est programmée.",
    );
  });

  it("autorise puis retire l'accès support, avec audit", async () => {
    const { until } = await (await caller(owner.token)).support.grantAccess({ hours: 24 });
    expect(until.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect((await (await caller(owner.token)).support.get()).active).toBe(true);
    await (await caller(owner.token)).support.revokeAccess();
    expect((await (await caller(owner.token)).support.get()).active).toBe(false);
    expect(
      await adminDb.auditLog.count({
        where: {
          organizationId: org.id,
          action: { in: ["support.access_granted", "support.access_revoked"] },
        },
      }),
    ).toBe(2);
  });
});
