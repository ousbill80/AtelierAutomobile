import { describe, expect, it } from "vitest";
import { evaluateAlerts, sortAlerts, type AlertScanInput } from "./alerts";

const base: AlertScanInput = {
  today: "2026-10-18",
  now: new Date("2026-10-18T08:00:00Z"),
  channels: [],
  messages24h: { total: 0, failed: 0 },
  dataSources: [],
  overdueInvoices: [],
  brokenPromises: [],
};

describe("evaluateAlerts (RG-M12-27)", () => {
  it("canal en erreur et solde SMS bas", () => {
    const alerts = evaluateAlerts({
      ...base,
      channels: [
        {
          id: "cc1",
          channel: "WHATSAPP",
          provider: "whatsapp_cloud",
          isActive: true,
          status: "ERROR",
          balance: null,
        },
        {
          id: "cc2",
          channel: "SMS",
          provider: "orange_sms",
          isActive: true,
          status: "OK",
          balance: 499,
        },
        {
          id: "cc3",
          channel: "SMS",
          provider: "twilio",
          isActive: true,
          status: "OK",
          balance: 500,
        },
        { id: "cc4", channel: "SMS", provider: "x", isActive: false, status: "ERROR", balance: 0 },
      ],
    });
    expect(alerts.map((a) => [a.code, a.objectId, a.severity])).toEqual([
      ["channel_error", "cc1", "critical"],
      ["sms_balance_low", "cc2", "warning"],
    ]);
    expect(alerts[0]!.dedupeKey).toBe("alert.channel_error:cc1:2026-10-18");
  });

  it("taux d'échec > 10 % sur au moins 20 envois", () => {
    expect(evaluateAlerts({ ...base, messages24h: { total: 19, failed: 10 } })).toEqual([]);
    expect(evaluateAlerts({ ...base, messages24h: { total: 20, failed: 2 } })).toEqual([]);
    const [alert] = evaluateAlerts({ ...base, messages24h: { total: 20, failed: 3 } });
    expect(alert).toMatchObject({
      code: "channel_error",
      objectId: "messages",
      params: { failedPct: 15 },
    });
  });

  it("import sans exécution réussie depuis > 3 jours", () => {
    const alerts = evaluateAlerts({
      ...base,
      dataSources: [
        {
          id: "ds1",
          name: "Ancien logiciel",
          isActive: true,
          lastRunAt: new Date("2026-10-14T07:00:00Z"),
          lastStatus: "SUCCESS",
        },
        {
          id: "ds2",
          name: "Récent",
          isActive: true,
          lastRunAt: new Date("2026-10-17T07:00:00Z"),
          lastStatus: "SUCCESS",
        },
        {
          id: "ds3",
          name: "En échec",
          isActive: true,
          lastRunAt: new Date("2026-10-18T07:00:00Z"),
          lastStatus: "FAILED",
        },
        { id: "ds4", name: "Inactif", isActive: false, lastRunAt: null, lastStatus: null },
      ],
    });
    expect(alerts.map((a) => a.objectId)).toEqual(["ds1", "ds3"]);
  });

  it("facture en retard > 45 j et promesse non tenue", () => {
    const alerts = evaluateAlerts({
      ...base,
      overdueInvoices: [
        {
          id: "i45",
          number: "FAC-1",
          customerName: "A",
          balance: 1000,
          dueDate: new Date("2026-09-03T00:00:00Z"),
        },
        {
          id: "i46",
          number: "FAC-2",
          customerName: "B",
          balance: 1000,
          dueDate: new Date("2026-09-02T00:00:00Z"),
        },
      ],
      brokenPromises: [{ id: "p1", amount: 310_000, customerName: "SOTRA" }],
    });
    expect(alerts.map((a) => [a.code, a.objectId])).toEqual([
      ["receivable_45d", "i46"],
      ["promise_broken", "p1"],
    ]);
  });
});

describe("evaluateAlerts — agent local hors ligne (US-M13-07)", () => {
  it("lève import_stale pour un agent sans battement depuis plus de 24 h", () => {
    const alerts = evaluateAlerts({
      ...base,
      agents: [
        {
          id: "a1",
          name: "PC Compta",
          status: "ONLINE",
          lastSeenAt: new Date("2026-10-17T07:00:00Z"),
        },
        {
          id: "a2",
          name: "PC Accueil",
          status: "OFFLINE",
          lastSeenAt: new Date("2026-10-17T09:00:00Z"),
        },
        { id: "a3", name: "Révoqué", status: "REVOKED", lastSeenAt: null },
        { id: "a4", name: "En appairage", status: "PAIRING", lastSeenAt: null },
      ],
    });
    expect(alerts.map((a) => [a.code, a.objectId, a.link])).toEqual([
      ["import_stale", "a1", "/import/agent"],
    ]);
    expect(alerts[0]!.params).toEqual({ name: "PC Compta", kind: "agent" });
  });
});

describe("sortAlerts (RG-M12-28)", () => {
  it("non lues, sévérité puis date décroissante, 5 max", () => {
    const n = (id: string, severity: string | null, iso: string, read = false) => ({
      id,
      severity,
      createdAt: new Date(iso),
      readAt: read ? new Date(iso) : null,
    });
    const sorted = sortAlerts([
      n("a", "info", "2026-10-18T10:00:00Z"),
      n("b", "warning", "2026-10-17T10:00:00Z"),
      n("c", "critical", "2026-10-16T10:00:00Z"),
      n("d", "warning", "2026-10-18T09:00:00Z"),
      n("e", "critical", "2026-10-18T09:00:00Z", true),
      n("f", null, "2026-10-18T11:00:00Z"),
      n("g", "info", "2026-10-10T11:00:00Z"),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["c", "d", "b", "f", "a"]);
  });
});
