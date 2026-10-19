import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { getObjectStorage } from "../storage";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function memberContextFor(organizationId: string, name: string, role: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: role as never, siteIds: [] },
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
  return { userId: user.id, token };
}

const CSV_SOURCE =
  "Nom & Prénoms;Téléphone;Email\n" +
  "Kouassi Jean-Marc;0747218890;jm.kouassi@example.com\n" +
  "Ibrahim Diallo;0505123456;ibrahim.diallo@example.com\n";

describe("import router (M13 — fichier)", () => {
  let org: { id: string };
  let otherOrg: { id: string };
  let manager: { userId: string; token: string };
  let advisor: { userId: string; token: string };
  let otherManager: { userId: string; token: string };
  const userIds: string[] = [];
  const jobIds: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Import Test" } });
    otherOrg = await adminDb.organization.create({ data: { name: "Garage Import Autre" } });
    manager = await memberContextFor(org.id, "Manager Import Test", "MANAGER");
    advisor = await memberContextFor(org.id, "Advisor Import Test", "ADVISOR");
    otherManager = await memberContextFor(otherOrg.id, "Manager Import Autre", "MANAGER");
    userIds.push(manager.userId, advisor.userId, otherManager.userId);
  });

  afterAll(async () => {
    await adminDb.importRowError.deleteMany({ where: { importJobId: { in: jobIds } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
    await adminDb.importJob.deleteMany({
      where: { organizationId: { in: [org.id, otherOrg.id] } },
    });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({
      where: { organizationId: { in: [org.id, otherOrg.id] } },
    });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  });

  async function createJobWithFile(token: string) {
    const caller = callerFactory(await contextFor(token));
    const { jobId } = await caller.import.upload({
      fileName: "clients.csv",
      size: CSV_SOURCE.length,
      mimeType: "text/csv",
    });
    jobIds.push(jobId);

    const job = await adminDb.importJob.findUniqueOrThrow({ where: { id: jobId } });
    const storage = getObjectStorage();
    await storage.upload({
      key: job.fileUrl!,
      body: new TextEncoder().encode(CSV_SOURCE),
      contentType: "text/csv",
    });
    return { caller, jobId };
  }

  it("import.upload refuse un rôle sans la permission import:run (ADVISOR)", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    await expect(
      caller.import.upload({ fileName: "clients.csv", size: 10, mimeType: "text/csv" }),
    ).rejects.toThrow("Permission manquante");
  });

  it("import.upload refuse un format non supporté", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    await expect(
      caller.import.upload({
        fileName: "clients.xlsx",
        size: 10,
        mimeType: "application/vnd.ms-excel.sheet",
      }),
    ).rejects.toThrow("Format non supporté");
  });

  it("parcours complet clients : analyze → setMapping → validate → simulate → run → re-import", async () => {
    const { caller, jobId } = await createJobWithFile(manager.token);

    const analyzed = await caller.import.analyze({ jobId });
    expect(analyzed.headers).toEqual(["Nom & Prénoms", "Téléphone", "Email"]);
    expect(analyzed.suggestedEntity).toBe("customers");

    const columns: Record<string, string> = {};
    for (const m of analyzed.mapping) {
      if (m.field) columns[m.column] = m.field;
    }
    expect(columns["Téléphone"]).toBe("customer.phone");
    expect(columns["Email"]).toBe("customer.email");

    await caller.import.setMapping({
      jobId,
      entity: "customers",
      columns,
      options: { policy: "UPSERT", treatMissingAsPaid: false },
    });

    const validated = await caller.import.validate({ jobId });
    expect(validated.counts.total).toBe(2);
    expect(validated.counts.errors).toBe(0);

    const simulated = await caller.import.simulate({ jobId });
    expect(simulated.create).toBe(2);
    expect(simulated.update).toBe(0);

    const ran = await caller.import.run({ jobId });
    expect(ran.status).toBe("COMPLETED");

    const customers = await adminDb.customer.findMany({ where: { organizationId: org.id } });
    expect(customers).toHaveLength(2);

    const progress = await caller.import.progress({ jobId });
    expect(progress.status).toBe("COMPLETED");
    expect(progress.counts.create).toBe(2);

    // Ré-import du même fichier : plus aucune création, tout est "unchanged".
    const { caller: caller2, jobId: jobId2 } = await createJobWithFile(manager.token);
    await caller2.import.analyze({ jobId: jobId2 });
    await caller2.import.setMapping({
      jobId: jobId2,
      entity: "customers",
      columns,
      options: { policy: "UPSERT", treatMissingAsPaid: false },
    });
    const resimulated = await caller2.import.simulate({ jobId: jobId2 });
    expect(resimulated.create).toBe(0);
    expect(resimulated.unchanged).toBe(2);
  });

  it("isolation multi-locataire : le job d'une organisation n'est pas visible pour une autre", async () => {
    const { jobId } = await createJobWithFile(manager.token);

    const otherCaller = callerFactory(await contextFor(otherManager.token));
    await expect(otherCaller.import.progress({ jobId })).rejects.toThrow("Import introuvable");

    const list = await otherCaller.import.list({});
    expect(list.jobs.find((j) => j.id === jobId)).toBeUndefined();
  });
});
