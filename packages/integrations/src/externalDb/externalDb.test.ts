import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cellToText,
  createExternalDatabase,
  createMemoryExternalDatabase,
  friendlyExternalDbError,
} from "./index";

describe("cellToText", () => {
  it("convertit les cellules SQL en texte importable", () => {
    expect(cellToText(null)).toBe("");
    expect(cellToText(185000)).toBe("185000");
    expect(cellToText(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(cellToText(new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-02T08:30:00.000Z");
  });
});

describe("friendlyExternalDbError (M13 §11)", () => {
  it("ne renvoie jamais le message brut du pilote", () => {
    const host = friendlyExternalDbError({
      code: "ENOTFOUND",
      message: "getaddrinfo ENOTFOUND db.garage.local",
    });
    expect(host.code).toBe("sync.host_unreachable");
    expect(host.message).not.toContain("garage.local");
    expect(
      friendlyExternalDbError({
        code: "28P01",
        message: 'password authentication failed for user "sa"',
      }).message,
    ).toBe("Identifiants refusés par la base.");
    expect(friendlyExternalDbError({ code: "57014" }).code).toBe("sync.query_timeout");
  });
});

describe("createMemoryExternalDatabase", () => {
  it("renvoie les résultats préparés et applique la limite de lignes", async () => {
    const db = createMemoryExternalDatabase(() => ({
      columns: ["a"],
      rows: [["1"], ["2"], ["3"]],
    }));
    await expect(db.query("SELECT a FROM t", new Date(0))).resolves.toEqual({
      columns: ["a"],
      rows: [["1"], ["2"], ["3"]],
    });
    await expect(db.query("SELECT a FROM t", new Date(0), { maxRows: 2 })).rejects.toMatchObject({
      code: "sync.too_many_rows",
    });
  });
});

// Base PostgreSQL locale jouant « l'ancien logiciel » (même serveur que DATABASE_URL).
const adminUrl = process.env.DATABASE_URL;
describe.skipIf(!adminUrl)("connexion PostgreSQL réelle (RG-M13-25/26)", () => {
  const dbName = `legacy_${randomBytes(3).toString("hex")}`;
  const roUser = `ro_${randomBytes(3).toString("hex")}`;
  const url = new URL(adminUrl ?? "postgresql://localhost");
  const admin = () =>
    new pg.Client({ connectionString: adminUrl!.replace(/\/[^/?]+(\?|$)/, "/postgres$1") });

  beforeAll(async () => {
    const c = admin();
    await c.connect();
    await c.query(`CREATE DATABASE ${dbName}`);
    await c.query(`CREATE ROLE ${roUser} LOGIN PASSWORD 'ro_pass'`);
    await c.end();
    const legacy = new pg.Client({
      connectionString: adminUrl!.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`),
    });
    await legacy.connect();
    await legacy.query(
      `CREATE TABLE factures (num text, client text, tel text, date_fact date, ttc int, regle int, modif timestamptz)`,
    );
    await legacy.query(`INSERT INTO factures VALUES
      ('F-0412', 'SOTRA Logistique', '0747218890', '2026-09-03', 185000, 0, '2026-10-18T10:00:00Z'),
      ('F-0300', 'Kouassi Jean-Marc', '0505112233', '2026-06-01', 90000, 90000, '2026-06-02T10:00:00Z')`);
    await legacy.query(`GRANT SELECT ON factures TO ${roUser}`);
    await legacy.end();
  });

  afterAll(async () => {
    const c = admin();
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.query(`DROP ROLE IF EXISTS ${roUser}`);
    await c.end();
  });

  const db = () =>
    createExternalDatabase({
      dbType: "postgres",
      host: url.hostname,
      port: Number(url.port || 5432),
      database: dbName,
      user: roUser,
      password: "ro_pass",
    });

  it("teste la connexion, compte les tables et détecte les droits d'écriture", async () => {
    await expect(db().test()).resolves.toEqual({ tables: 1, canWrite: false });
    const owner = createExternalDatabase({
      dbType: "postgres",
      host: url.hostname,
      port: Number(url.port || 5432),
      database: dbName,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    });
    await expect(owner.test()).resolves.toMatchObject({ canWrite: true });
  });

  it("lie :since et ne renvoie que les lignes modifiées depuis", async () => {
    const result = await db().query(
      'SELECT num AS "externalNumber", client AS "displayName", tel AS phone, date_fact AS "issuedAt", ttc AS total, regle AS "amountPaid" FROM factures WHERE modif >= :since ORDER BY num',
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(result).toEqual({
      columns: ["externalNumber", "displayName", "phone", "issuedAt", "total", "amountPaid"],
      rows: [["F-0412", "SOTRA Logistique", "0747218890", "2026-09-03", "185000", "0"]],
    });
  });

  it("traduit les erreurs (table absente, hôte injoignable)", async () => {
    await expect(db().query("SELECT * FROM table_absente", new Date(0))).rejects.toMatchObject({
      code: "sync.query_failed",
    });
    const unreachable = createExternalDatabase({
      dbType: "postgres",
      host: "127.0.0.1",
      port: 1,
      database: dbName,
      user: roUser,
      password: "ro_pass",
    });
    await expect(unreachable.test()).rejects.toMatchObject({ code: "sync.host_unreachable" });
  });
});
