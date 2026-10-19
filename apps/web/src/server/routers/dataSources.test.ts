import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function callerFor(organizationId: string, role: "OWNER" | "MANAGER") {
  const user = await adminDb.user.create({
    data: { name: `Sync ${role}`, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({ data: { organizationId, userId: user.id, role, siteIds: [] } });
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
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

// La base locale de test joue « l'ancien logiciel » : même serveur PostgreSQL.
const dbUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost:5432/x");
const connection = {
  dbType: "postgres" as const,
  host: dbUrl.hostname,
  port: Number(dbUrl.port || 5432),
  database: dbUrl.pathname.slice(1),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
};

describe("dataSources router (M13 partie 2)", () => {
  let orgA: { id: string };
  let ownerA: ReturnType<typeof callerFactory>;
  let ownerB: ReturnType<typeof callerFactory>;
  let sourceId: string;
  const phone = `07${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Sources A" } });
    const orgB = await adminDb.organization.create({ data: { name: "Garage Sources B" } });
    await adminDb.site.create({ data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" } });
    ownerA = await callerFor(orgA.id, "OWNER");
    ownerB = await callerFor(orgB.id, "OWNER");
  });

  it("crée une source, ne renvoie jamais le mot de passe, et la journalise", async () => {
    const created = await ownerA.dataSources.create({
      ...connection,
      name: "Logiciel atelier",
      queries: { customers: `SELECT 'Client Synchro' AS "displayName", '${phone}' AS phone` },
    });
    sourceId = created.id;
    const list = await ownerA.dataSources.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.connection).toMatchObject({
      dbType: "postgres",
      hasPassword: Boolean(connection.password),
    });
    expect(JSON.stringify(list)).not.toContain('"password"');
    expect(JSON.stringify(list)).not.toContain("config");
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "data_source.created" },
    });
    expect(JSON.stringify(audit?.after)).not.toContain("password");
  });

  it("refuse une requête d'écriture et un planning trop fréquent", async () => {
    await expect(
      ownerA.dataSources.create({
        ...connection,
        name: "x",
        queries: { customers: "DELETE FROM Clients" },
      }),
    ).rejects.toThrow("SELECT ou WITH");
    await expect(
      ownerA.dataSources.create({ ...connection, name: "x", schedule: "*/5 * * * *" }),
    ).rejects.toThrow("15 minutes");
  });

  it("teste la connexion, prévisualise et synchronise réellement", async () => {
    await expect(ownerA.dataSources.test({ id: sourceId })).resolves.toMatchObject({ ok: true });
    await expect(
      ownerA.dataSources.test({ ...connection, port: 1, password: "x" }),
    ).resolves.toEqual({
      ok: false,
      error: "Hôte injoignable depuis internet : vérifiez l'adresse ou installez l'agent local.",
    });
    const preview = await ownerA.dataSources.previewQuery({
      id: sourceId,
      entity: "customers",
      sql: `SELECT 'Client Synchro' AS "displayName", '${phone}' AS phone`,
    });
    expect(preview.columns).toEqual(["displayName", "phone"]);

    await ownerA.dataSources.runNow({ id: sourceId });
    const customer = await adminDb.customer.findFirst({
      where: { organizationId: orgA.id, displayName: "Client Synchro" },
    });
    expect(customer?.phone).toBe(`+225${phone}`);
    const detail = await ownerA.dataSources.get({ id: sourceId });
    expect(detail).toMatchObject({ lastStatus: "SUCCESS", consecutiveFailures: 0 });
    expect(detail.runs[0]).toMatchObject({
      entity: "customers",
      status: "COMPLETED",
      createdCount: 1,
    });
  });

  it("modifier sans mot de passe conserve celui enregistré", async () => {
    await ownerA.dataSources.update({ id: sourceId, name: "Logiciel atelier (prod)" });
    await expect(ownerA.dataSources.test({ id: sourceId })).resolves.toMatchObject({ ok: true });
  });

  it("isolation multi-locataire et permission integration:manage", async () => {
    expect(await ownerB.dataSources.list()).toEqual([]);
    await expect(ownerB.dataSources.get({ id: sourceId })).rejects.toThrow("Source introuvable.");
    await expect(ownerB.dataSources.runNow({ id: sourceId })).rejects.toThrow(
      "Source introuvable.",
    );
    await expect(ownerB.dataSources.delete({ id: sourceId })).rejects.toThrow(
      "Source introuvable.",
    );
    const manager = await callerFor(orgA.id, "MANAGER");
    await expect(manager.dataSources.list()).rejects.toThrow(/integration:manage/);
  });

  it("supprimer = désactiver (historique conservé)", async () => {
    await ownerA.dataSources.delete({ id: sourceId });
    const row = await adminDb.dataSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(row.isActive).toBe(false);
  });
});
