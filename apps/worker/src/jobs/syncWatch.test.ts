import { adminDb } from "@atelieros/db";
import { describe, expect, it } from "vitest";
import { findDueSqlSources, processAgentsHealthJob } from "./syncWatch";

describe("imports.watch — sources dues (RG-M13-27)", () => {
  it("ne retient que les sources SQL actives dont le planning est échu", async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Watch Test" } });
    const base = { organizationId: org.id, config: "", schedule: "0 2 * * *" };
    const due = await adminDb.dataSource.create({
      data: {
        ...base,
        type: "SQL_DATABASE",
        name: "due",
        lastRunAt: new Date("2026-10-18T02:00:30Z"),
      },
    });
    await adminDb.dataSource.create({
      data: {
        ...base,
        type: "SQL_DATABASE",
        name: "déjà faite",
        lastRunAt: new Date("2026-10-19T02:00:30Z"),
      },
    });
    await adminDb.dataSource.create({
      data: {
        ...base,
        type: "SQL_DATABASE",
        name: "inactive",
        isActive: false,
        lastRunAt: new Date(0),
      },
    });
    await adminDb.dataSource.create({
      data: { ...base, type: "FILE_UPLOAD", name: "fichier", lastRunAt: new Date(0) },
    });
    const result = await findDueSqlSources(new Date("2026-10-19T02:10:00Z"));
    const mine = result.filter((r) => r.data.organizationId === org.id);
    expect(mine.map((r) => r.data.dataSourceId)).toEqual([due.id]);
  });

  it("sync.agents_health : passe hors ligne un agent sans battement depuis 15 min", async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Agents Health" } });
    const now = new Date("2026-10-19T10:00:00Z");
    const stale = await adminDb.syncAgent.create({
      data: {
        organizationId: org.id,
        name: "vieux",
        status: "ONLINE",
        lastSeenAt: new Date("2026-10-19T09:44:00Z"),
      },
    });
    const fresh = await adminDb.syncAgent.create({
      data: {
        organizationId: org.id,
        name: "récent",
        status: "ONLINE",
        lastSeenAt: new Date("2026-10-19T09:50:00Z"),
      },
    });
    await processAgentsHealthJob(now);
    expect((await adminDb.syncAgent.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      "OFFLINE",
    );
    expect((await adminDb.syncAgent.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      "ONLINE",
    );
  });
});
