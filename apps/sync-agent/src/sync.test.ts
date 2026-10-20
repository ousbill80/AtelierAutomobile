import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createMemoryExternalDatabase, type ExternalQueryResult } from "@atelieros/integrations";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentApi, AgentApiError, type FetchLike, type SyncBatchPayload } from "./api";
import { LocalStore } from "./store";
import { flushQueue, runSync } from "./sync";

/** Serveur simulé : enregistre les lots reçus ; réseau coupable à la demande. */
function fakeServer() {
  const state = {
    received: [] as { key: string; batch: SyncBatchPayload }[],
    offline: false,
    revoked: false,
    queries: { customers: "SELECT * FROM Clients WHERE DateModif >= :since" } as Record<
      string,
      string | null
    >,
  };
  const fetchImpl: FetchLike = async (url, init) => {
    if (state.offline) throw new TypeError("fetch failed");
    if (state.revoked) {
      return Response.json(
        { error: { code: "invalid_agent_token", message: "Jeton révoqué" } },
        { status: 401 },
      );
    }
    if (url.endsWith("/config")) {
      return Response.json({
        agent_id: "a1",
        active: true,
        schedule: "0 2 * * *",
        timezone: "Africa/Abidjan",
        policy: "UPSERT",
        queries: state.queries,
        server_time: new Date().toISOString(),
      });
    }
    if (url.endsWith("/batches")) {
      const headers = new Headers(init?.headers);
      const batch = JSON.parse(gunzipSync(Buffer.from(init!.body as Uint8Array)).toString("utf8"));
      state.received.push({ key: headers.get("idempotency-key")!, batch });
      return Response.json({ created: batch.rows.length, updated: 0, errors: 0 });
    }
    return Response.json({ clock_skew: false });
  };
  return { state, api: new AgentApi("https://app.test", "sa_live_x", fetchImpl) };
}

let table: ExternalQueryResult;
const db = () => createMemoryExternalDatabase(() => table);
const at = (iso: string) => new Date(iso);

describe("agent local — runSync (RG-M13-28)", () => {
  let store: LocalStore;
  beforeEach(() => {
    store = new LocalStore(mkdtempSync(path.join(tmpdir(), "agent-")));
    table = {
      columns: ["displayName", "phone"],
      rows: [
        ["SOTRA Logistique", "0747218890"],
        ["Kouassi Jean-Marc", "0505112233"],
      ],
    };
  });

  it("n'envoie que les lignes changées, en lots idempotents", async () => {
    const { state, api } = fakeServer();
    const first = await runSync({ api, store, db: db(), now: at("2026-10-19T02:00:00Z") });
    expect(first.queued).toEqual({ customers: 2 });
    expect(state.received).toHaveLength(1);
    expect(state.received[0]!.key).toMatch(/^[0-9a-f]{64}$/);
    expect(store.loadState().lastSuccessAt).toBe("2026-10-19T02:00:00.000Z");

    const second = await runSync({ api, store, db: db(), now: at("2026-10-20T02:00:00Z") });
    expect(second.queued).toEqual({ customers: 0 });
    expect(state.received).toHaveLength(1);

    table.rows[1] = ["Kouassi Jean-Marc", "0707000000"];
    await runSync({ api, store, db: db(), now: at("2026-10-21T02:00:00Z") });
    expect(state.received[1]!.batch.rows).toEqual([["Kouassi Jean-Marc", "0707000000"]]);
  });

  it("découpe en lots de 500 envoyés dans l'ordre de mise en file", async () => {
    const { state, api } = fakeServer();
    table = {
      columns: ["phone"],
      rows: Array.from({ length: 1201 }, (_, i) => [`07${String(i).padStart(8, "0")}`]),
    };
    await runSync({ api, store, db: db(), now: at("2026-10-19T02:00:00Z") });
    expect(state.received.map((r) => r.batch.rows.length)).toEqual([500, 500, 201]);
    expect(state.received[0]!.batch.rows[0]).toEqual(["0700000000"]);
  });

  it("internet coupé : les lots attendent dans la file et partent au retour du réseau", async () => {
    const { state, api } = fakeServer();
    await runSync({ api, store, db: db(), now: at("2026-10-19T02:00:00Z") });
    table.rows.push(["Nouveau client", "0101010101"]);
    state.offline = true;
    await expect(
      runSync({ api, store, db: db(), now: at("2026-10-20T02:00:00Z") }),
    ).rejects.toThrow("injoignable");
    // La configuration est inaccessible : rien n'a été lu ni mis en file.
    expect(store.pending()).toHaveLength(0);

    state.offline = false;
    const config = await api.getConfig();
    expect(config.active).toBe(true);
    // Coupure après la mise en file : le lot reste en attente…
    const realSend = api.sendBatch.bind(api);
    api.sendBatch = async () => {
      throw new AgentApiError(
        0,
        "network_error",
        "Serveur AtelierOS injoignable (internet coupé ?).",
      );
    };
    const offlineRun = await runSync({ api, store, db: db(), now: at("2026-10-20T03:00:00Z") });
    expect(offlineRun.flush).toMatchObject({ sent: 0, remaining: 1 });
    expect(store.loadState().lastSuccessAt).toBe("2026-10-19T02:00:00.000Z");
    // … et part au retour du réseau.
    api.sendBatch = realSend;
    const flushed = await flushQueue(api, store, at("2026-10-20T04:00:00Z"));
    expect(flushed).toMatchObject({ sent: 1, remaining: 0 });
    expect(state.received.at(-1)!.batch.rows).toEqual([["Nouveau client", "0101010101"]]);
  });

  it("écarte les lots de plus de 7 jours et s'arrête si l'agent est révoqué", async () => {
    const { state, api } = fakeServer();
    store.enqueue({
      key: "vieux",
      createdAt: "2026-10-01T00:00:00.000Z",
      batch: { entity: "customers", columns: ["phone"], rows: [["x"]] },
    });
    expect(await flushQueue(api, store, at("2026-10-19T00:00:00Z"))).toMatchObject({
      dropped: 1,
      sent: 0,
    });
    store.enqueue({
      key: "recent",
      createdAt: "2026-10-18T00:00:00.000Z",
      batch: { entity: "customers", columns: ["phone"], rows: [["x"]] },
    });
    state.revoked = true;
    await expect(flushQueue(api, store, at("2026-10-19T00:00:00Z"))).rejects.toMatchObject({
      status: 401,
    });
    expect(store.pending()).toHaveLength(1);
  });
});
