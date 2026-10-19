import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { appRouter } from "../routers/_app";
import { createCallerFactory } from "../trpc";
import { handleBatch, handleConfig, handleHeartbeat, handlePair } from "./agent";

const callerFactory = createCallerFactory(appRouter);

async function ownerCaller(organizationId: string) {
  const user = await adminDb.user.create({
    data: { name: "Gérant agent", email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

const BASE = "http://localhost/api/v1/sync";
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("API de l'agent local (RG-M13-28)", () => {
  let orgId: string;
  let owner: Awaited<ReturnType<typeof ownerCaller>>;
  let agentToken: string;
  let dataSourceId: string;
  let agentId: string;
  const phone = `07${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;
  const auth = () => ({ authorization: `Bearer ${agentToken}` });

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Agent Test" } });
    orgId = org.id;
    await adminDb.site.create({ data: { organizationId: orgId, name: "Yopougon", code: "YOP" } });
    owner = await ownerCaller(orgId);
  });

  it("appaire avec le code (une seule fois) et refuse un code inconnu", async () => {
    const pairing = await owner.syncAgents.createPairingCode({ name: "PC Comptabilité" });
    expect(pairing.code).toMatch(/^[A-Z2-9]{8}$/);
    dataSourceId = pairing.dataSourceId;
    agentId = pairing.agentId;

    const bad = await handlePair(new Request(`${BASE}/pair`, json({ code: "ZZZZZZZZ" })));
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.code).toBe("invalid_pairing_code");

    const code = `${pairing.code.slice(0, 4).toLowerCase()}-${pairing.code.slice(4)}`;
    const ok = await handlePair(
      new Request(`${BASE}/pair`, json({ code, hostname: "PC-COMPTA", version: "1.0.0" })),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ agent_id: agentId, organization_name: "Garage Agent Test" });
    agentToken = body.token;
    expect(agentToken).toMatch(/^sa_live_/);

    const replay = await handlePair(new Request(`${BASE}/pair`, json({ code: pairing.code })));
    expect(replay.status).toBe(401);
    const stored = await adminDb.syncAgent.findUniqueOrThrow({ where: { id: agentId } });
    expect(stored.tokenHash).not.toContain(agentToken);
    expect(stored).toMatchObject({ status: "ONLINE", hostname: "PC-COMPTA", pairingCode: null });
  });

  it("refuse un jeton invalide et sert la configuration de la source de l'agent", async () => {
    expect((await handleConfig(new Request(`${BASE}/config`))).status).toBe(401);
    await owner.dataSources.update({
      id: dataSourceId,
      queries: {
        customers: "SELECT Nom AS displayName, Tel AS phone FROM Clients WHERE DateModif >= :since",
      },
    });
    const res = await handleConfig(new Request(`${BASE}/config`, { headers: auth() }));
    expect(await res.json()).toMatchObject({
      agent_id: agentId,
      active: true,
      schedule: "0 2 * * *",
      queries: { customers: expect.stringContaining(":since"), vehicles: null },
    });
  });

  it("importe un lot gzip, idempotent par Idempotency-Key", async () => {
    const batch = {
      entity: "customers",
      columns: ["displayName", "phone"],
      rows: [["Client Agent", phone]],
    };
    const send = () =>
      handleBatch(
        new Request(`${BASE}/batches`, {
          method: "POST",
          headers: {
            ...auth(),
            "content-type": "application/json",
            "content-encoding": "gzip",
            "idempotency-key": "lot-1",
          },
          body: gzipSync(JSON.stringify(batch)),
        }),
      );
    const first = await send();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      entity: "customers",
      rows: 1,
      created: 1,
      errors: 0,
    });
    const second = await send();
    expect((await second.json()).created).toBe(1); // réponse rejouée, rien de réécrit
    expect(
      await adminDb.customer.count({ where: { organizationId: orgId, phone: `+225${phone}` } }),
    ).toBe(1);
    expect(await adminDb.syncBatch.count({ where: { agentId } })).toBe(1);
    const source = await adminDb.dataSource.findUniqueOrThrow({ where: { id: dataSourceId } });
    expect(source.lastStatus).toBe("SUCCESS");
  });

  it("valide les lots", async () => {
    const noKey = await handleBatch(
      new Request(
        `${BASE}/batches`,
        json({ entity: "customers", columns: ["a"], rows: [] }, auth()),
      ),
    );
    expect(noKey.status).toBe(400);
    const badRow = await handleBatch(
      new Request(
        `${BASE}/batches`,
        json(
          { entity: "customers", columns: ["a", "b"], rows: [["x"]] },
          { ...auth(), "idempotency-key": "k2" },
        ),
      ),
    );
    expect(badRow.status).toBe(422);
    const badEntity = await handleBatch(
      new Request(
        `${BASE}/batches`,
        json(
          { entity: "products", columns: ["a"], rows: [] },
          { ...auth(), "idempotency-key": "k3" },
        ),
      ),
    );
    expect(badEntity.status).toBe(422);
  });

  it("battement : signale un décalage d'horloge > 5 min", async () => {
    const res = await handleHeartbeat(
      new Request(
        `${BASE}/heartbeat`,
        json(
          { version: "1.0.1", agent_time: new Date(Date.now() - 10 * 60_000).toISOString() },
          auth(),
        ),
      ),
    );
    expect(await res.json()).toMatchObject({ status: "ONLINE", clock_skew: true });
    const [listed] = await owner.syncAgents.list();
    expect(listed).toMatchObject({ status: "ONLINE", version: "1.0.1" });
    expect(listed!.lastError).toContain("Horloge");
  });

  it("une source d'agent ne se synchronise pas depuis le serveur", async () => {
    await expect(owner.dataSources.runNow({ id: dataSourceId })).rejects.toThrow("agent local");
  });

  it("révocation : 401 immédiat et source désactivée ; autre organisation sans accès", async () => {
    const other = await adminDb.organization.create({ data: { name: "Garage Agent Autre" } });
    const otherOwner = await ownerCaller(other.id);
    expect(await otherOwner.syncAgents.list()).toEqual([]);
    await expect(otherOwner.syncAgents.revoke({ id: agentId })).rejects.toThrow(
      "Agent introuvable.",
    );

    await owner.syncAgents.revoke({ id: agentId });
    expect((await handleConfig(new Request(`${BASE}/config`, { headers: auth() }))).status).toBe(
      401,
    );
    const source = await adminDb.dataSource.findUniqueOrThrow({ where: { id: dataSourceId } });
    expect(source.isActive).toBe(false);
  });
});
