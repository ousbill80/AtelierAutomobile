import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { createMemoryExternalDatabase, type ExternalQueryResult } from "@atelieros/integrations";
import { beforeAll, describe, expect, it } from "vitest";
import { runSqlSync, serializeSqlSourceConfig, type SqlSourceConfig } from "./sync";

const key = randomBytes(32);

const CUSTOMERS: ExternalQueryResult = {
  columns: ["externalId", "displayName", "phone"],
  rows: [
    ["C-1", "SOTRA Logistique", "0747218890"],
    ["C-2", "Kouassi Jean-Marc", "0505112233"],
  ],
};
const INVOICES: ExternalQueryResult = {
  columns: ["externalNumber", "phone", "issuedAt", "dueDate", "total", "amountPaid"],
  rows: [["F-0412", "0747218890", "2026-09-03", "2026-10-03", "185000", "0"]],
};

function memoryDb(seen: { sql: string; since: Date }[]) {
  return () =>
    createMemoryExternalDatabase((sql, since) => {
      seen.push({ sql, since });
      return sql.includes("Clients") ? CUSTOMERS : INVOICES;
    });
}

describe("runSqlSync (M13 partie 2, RG-M13-25 à 27)", () => {
  let org: { id: string };
  let owner: { id: string };
  let sourceId: string;
  const config: SqlSourceConfig = {
    dbType: "memory",
    queries: {
      customers: "SELECT * FROM Clients WHERE DateModif >= :since",
      invoices: "SELECT * FROM Factures WHERE DateModif >= :since",
    },
  };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Synchro Test" } });
    await adminDb.site.create({ data: { organizationId: org.id, name: "Yopougon", code: "YOP" } });
    const user = await adminDb.user.create({
      data: { name: "Gérant synchro", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    owner = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    const source = await adminDb.dataSource.create({
      data: {
        organizationId: org.id,
        type: "SQL_DATABASE",
        name: "Logiciel atelier",
        config: serializeSqlSourceConfig(config, key),
      },
    });
    sourceId = source.id;
  });

  it("importe clients puis factures avec le pipeline d'import, puis ne réécrit rien", async () => {
    const seen: { sql: string; since: Date }[] = [];
    const first = await runSqlSync({
      organizationId: org.id,
      dataSourceId: sourceId,
      encryptionKey: key,
      now: new Date("2026-10-19T02:00:00Z"),
      createDb: memoryDb(seen),
    });
    expect(first.status).toBe("SUCCESS");
    expect(first.entities.map((e) => [e.entity, e.create, e.error])).toEqual([
      ["customers", 2, 0],
      ["invoices", 1, 0],
    ]);
    expect(seen[0]!.since.getTime()).toBe(0); // première synchro : tout l'historique
    const invoice = await adminDb.invoice.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(invoice).toMatchObject({
      externalNumber: "F-0412",
      balance: 185_000,
      origin: "IMPORTED",
    });
    const jobs = await adminDb.importJob.findMany({ where: { dataSourceId: sourceId } });
    expect(jobs.every((j) => j.status === "COMPLETED")).toBe(true);

    seen.length = 0;
    const second = await runSqlSync({
      organizationId: org.id,
      dataSourceId: sourceId,
      encryptionKey: key,
      now: new Date("2026-10-20T02:00:00Z"),
      createDb: memoryDb(seen),
    });
    expect(second.entities.map((e) => [e.entity, e.create, e.update])).toEqual([
      ["customers", 0, 0],
      ["invoices", 0, 0],
    ]);
    // :since = dernière synchro réussie − 1 jour (RG-M13-26).
    expect(seen[0]!.since.toISOString()).toBe("2026-10-18T02:00:00.000Z");
    expect(await adminDb.customer.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("refuse une requête d'écriture, compte les échecs et alerte l'OWNER au 3e", async () => {
    const piege: SqlSourceConfig = {
      dbType: "memory",
      queries: { customers: "SELECT 1; DROP TABLE Clients" },
    };
    const bad = await adminDb.dataSource.create({
      data: {
        organizationId: org.id,
        type: "SQL_DATABASE",
        name: "Source piégée",
        config: serializeSqlSourceConfig(piege, key),
      },
    });
    for (let i = 0; i < 3; i++) {
      const result = await runSqlSync({
        organizationId: org.id,
        dataSourceId: bad.id,
        encryptionKey: key,
        now: new Date(),
        createDb: memoryDb([]),
      });
      expect(result).toMatchObject({
        status: "FAILED",
        error: expect.stringContaining("Une seule requête"),
      });
    }
    const after = await adminDb.dataSource.findUniqueOrThrow({ where: { id: bad.id } });
    expect(after).toMatchObject({
      consecutiveFailures: 3,
      lastStatus: "FAILED",
      lastSuccessAt: null,
    });
    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id, membershipId: owner.id, type: "import.sync_failed" },
    });
    expect(notifications).toHaveLength(1);
  });
});
