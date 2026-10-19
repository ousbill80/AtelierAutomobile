import { adminDb } from "@atelieros/db";
import { describe, expect, it } from "vitest";
import { findDueSqlSources } from "./syncWatch";

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
});
