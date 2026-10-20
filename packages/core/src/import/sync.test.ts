import { describe, expect, it } from "vitest";
import {
  assertReadOnlySelect,
  assertSyncSchedule,
  bindSince,
  isSyncDue,
  mapSyncColumns,
  shouldNotifySyncFailure,
  sinceFor,
} from "./sync";

describe("assertReadOnlySelect (RG-M13-25)", () => {
  it.each([
    "SELECT * FROM Clients",
    "select c.Nom, c.Tel from Clients c where c.DateModif >= :since;",
    "WITH f AS (SELECT * FROM Factures) SELECT * FROM f",
    "SELECT 'DROP TABLE x; DELETE' AS piege FROM Clients",
    "SELECT [Update] FROM Clients -- DELETE en commentaire",
    'SELECT "Insert" FROM Clients /* ; DROP */',
  ])("accepte %s", (sql) => {
    expect(() => assertReadOnlySelect(sql)).not.toThrow();
  });

  it.each([
    ["SELECT 1; DROP TABLE Clients", "sync.query_multiple"],
    ["SELECT 1;\nSELECT 2", "sync.query_multiple"],
    ["DELETE FROM Clients", "sync.query_not_select"],
    ["UPDATE Clients SET Nom = 'x'", "sync.query_not_select"],
    ["SELECT * INTO Copie FROM Clients", "sync.query_forbidden_keyword"],
    ["WITH x AS (DELETE FROM Clients RETURNING *) SELECT * FROM x", "sync.query_forbidden_keyword"],
    ["SELECT * FROM Clients; EXEC xp_cmdshell 'dir'", "sync.query_multiple"],
    ["   ", "sync.query_empty"],
  ])("refuse %s", (sql, code) => {
    expect(() => assertReadOnlySelect(sql)).toThrow(expect.objectContaining({ code }));
  });
});

describe("bindSince (RG-M13-26)", () => {
  const sql = "SELECT * FROM F WHERE DateModif >= :since OR Creation >= :since AND x = ':since'";
  it("paramètre selon le dialecte, sans toucher aux littéraux ni à :sinceX", () => {
    expect(bindSince(sql, "postgres")).toEqual({
      sql: "SELECT * FROM F WHERE DateModif >= $1 OR Creation >= $1 AND x = ':since'",
      occurrences: 2,
    });
    expect(bindSince(sql, "mysql").sql).toContain(">= ? OR Creation >= ?");
    expect(bindSince(sql, "mssql").sql).toContain(">= @since OR");
    expect(bindSince("SELECT :sinceDate", "mysql")).toEqual({
      sql: "SELECT :sinceDate",
      occurrences: 0,
    });
  });

  it("dernière synchro réussie − 1 jour ; première fois : tout l'historique", () => {
    expect(sinceFor(new Date("2026-10-18T02:00:00Z")).toISOString()).toBe(
      "2026-10-17T02:00:00.000Z",
    );
    expect(sinceFor(null).getTime()).toBe(0);
  });
});

describe("planification (RG-M13-27)", () => {
  it("refuse un planning invalide ou plus fréquent que 15 min", () => {
    expect(() => assertSyncSchedule("0 2 * * *", "Africa/Abidjan")).not.toThrow();
    expect(() => assertSyncSchedule("*/15 * * * *", "Africa/Abidjan")).not.toThrow();
    expect(() => assertSyncSchedule("*/5 * * * *", "Africa/Abidjan")).toThrow(
      expect.objectContaining({ code: "sync.schedule_too_frequent" }),
    );
    expect(() => assertSyncSchedule("pas un cron", "Africa/Abidjan")).toThrow(
      expect.objectContaining({ code: "sync.schedule_invalid" }),
    );
  });

  it("est due quand une occurrence tombe après la dernière exécution", () => {
    const tz = "Africa/Abidjan";
    const lastRun = new Date("2026-10-18T02:00:30Z");
    expect(isSyncDue("0 2 * * *", lastRun, new Date("2026-10-19T01:59:00Z"), tz)).toBe(false);
    expect(isSyncDue("0 2 * * *", lastRun, new Date("2026-10-19T02:00:00Z"), tz)).toBe(true);
    expect(isSyncDue(null, lastRun, new Date("2026-10-19T02:05:00Z"), tz)).toBe(true);
  });

  it("notifie au 3e échec consécutif seulement", () => {
    expect([1, 2, 3, 4].map(shouldNotifySyncFailure)).toEqual([false, false, true, false]);
  });
});

describe("mapSyncColumns", () => {
  it("nom exact, nom court de l'entité, nom court unique, puis synonymes", () => {
    expect(
      mapSyncColumns("invoices", [
        "externalNumber",
        "total",
        "amountPaid",
        "issuedAt",
        "phone",
        "customer.displayName",
        "Echeance",
        "colonne_inconnue",
      ]),
    ).toEqual({
      externalNumber: "invoice.externalNumber",
      total: "invoice.total",
      amountPaid: "invoice.amountPaid",
      issuedAt: "invoice.issuedAt",
      phone: "customer.phone",
      "customer.displayName": "customer.displayName",
      Echeance: "invoice.dueDate",
    });
  });
});
