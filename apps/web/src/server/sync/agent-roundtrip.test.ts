import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { createMemoryExternalDatabase } from "@atelieros/integrations";
import { AgentApi, LocalStore, runSync, type FetchLike } from "@atelieros/sync-agent";
import { describe, expect, it } from "vitest";
import { createContext } from "../context";
import { appRouter } from "../routers/_app";
import { createCallerFactory } from "../trpc";
import { handleBatch, handleConfig, handleHeartbeat, handlePair } from "./agent";

// Aller-retour complet : le client réel de l'agent (apps/sync-agent) parle aux gestionnaires
// réels de /api/v1/sync/* (sans serveur HTTP : le fetch est routé vers les gestionnaires).
const serverFetch: FetchLike = async (url, init) => {
  const req = new Request(url, init);
  const route = new URL(url).pathname.replace("/api/v1/sync/", "");
  switch (route) {
    case "pair":
      return handlePair(req);
    case "config":
      return handleConfig(req);
    case "batches":
      return handleBatch(req);
    case "heartbeat":
      return handleHeartbeat(req);
    default:
      return new Response("Not found", { status: 404 });
  }
};

describe("agent local ↔ AtelierOS (RG-M13-28, US-M13-07)", () => {
  it("appaire, lit la base locale, pousse les lignes changées et les importe", async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Aller-Retour" } });
    await adminDb.site.create({ data: { organizationId: org.id, name: "Yopougon", code: "YOP" } });
    const user = await adminDb.user.create({
      data: { name: "Gérant", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    const token = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: org.id,
        isPinSession: false,
      },
    });
    const owner = createCallerFactory(appRouter)(
      await createContext({
        req: new Request("http://localhost/api/trpc", {
          headers: { cookie: `atelieros_session=${token}` },
        }),
        resHeaders: new Headers(),
        info: undefined as never,
      }),
    );

    // Côté AtelierOS : code d'appairage et requêtes de la source de l'agent.
    const pairing = await owner.syncAgents.createPairingCode({ name: "PC Comptabilité" });
    await owner.dataSources.update({
      id: pairing.dataSourceId,
      queries: {
        customers: "SELECT Nom AS displayName, Tel AS phone FROM Clients WHERE DateModif >= :since",
        invoices: "SELECT * FROM Factures WHERE DateModif >= :since",
      },
    });

    // Côté garage : appairage puis synchronisation depuis la base locale (ici en mémoire).
    const phone = `07${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;
    const paired = await new AgentApi("https://app.test", null, serverFetch).pair(pairing.code, {
      hostname: "PC-COMPTA",
      version: "0.1.0",
    });
    const api = new AgentApi("https://app.test", paired.token, serverFetch);
    const store = new LocalStore(mkdtempSync(path.join(tmpdir(), "agent-rt-")));
    const localDb = () =>
      createMemoryExternalDatabase((sql) =>
        sql.includes("Clients")
          ? { columns: ["displayName", "phone"], rows: [["SOTRA Logistique", phone]] }
          : {
              columns: ["externalNumber", "phone", "issuedAt", "dueDate", "total", "amountPaid"],
              rows: [["F-0412", phone, "2026-09-03", "2026-10-03", "185000", "0"]],
            },
      );

    const first = await runSync({ api, store, db: localDb(), now: new Date() });
    expect(first.queued).toEqual({ customers: 1, invoices: 1 });
    expect(first.flush).toMatchObject({ sent: 2, remaining: 0 });
    const invoice = await adminDb.invoice.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(invoice).toMatchObject({
      externalNumber: "F-0412",
      balance: 185_000,
      origin: "IMPORTED",
    });

    const second = await runSync({ api, store, db: localDb(), now: new Date() });
    expect(second.flush.sent).toBe(0);
    expect(await adminDb.customer.count({ where: { organizationId: org.id } })).toBe(1);

    await api.heartbeat({
      version: "0.1.0",
      hostname: "PC-COMPTA",
      last_error: null,
      agent_time: new Date().toISOString(),
    });
    const [agent] = await owner.syncAgents.list();
    expect(agent).toMatchObject({ status: "ONLINE", hostname: "PC-COMPTA" });
    expect(agent!.lastSyncAt).not.toBeNull();
  });
});
