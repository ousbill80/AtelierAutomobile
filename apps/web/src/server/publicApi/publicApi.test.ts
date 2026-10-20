// Étape 6.4 (M13 partie 3) — API publique v1 et webhooks sortants : clés hachées et portée par
// organisation, scopes, idempotence des POST, pagination, limitation de débit, journal d'accès,
// external_id, webhooks signés HMAC avec reprises et désactivation. Horloge figée, transport de
// webhook simulé (aucun réseau).
import { randomBytes } from "node:crypto";
import {
  computeSessionAbsoluteExpiry,
  fixedClock,
  verifyWebhookSignatureHeader,
} from "@atelieros/core";
import { adminDb, deliverDueWebhooks, fanoutWebhookEvents } from "@atelieros/db";
import { webhookHmac, type WebhookRequest } from "@atelieros/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as customersRoute from "../../app/api/v1/customers/route";
import * as customerRoute from "../../app/api/v1/customers/[id]/route";
import * as balanceRoute from "../../app/api/v1/customers/[id]/balance/route";
import * as byExternalRoute from "../../app/api/v1/customers/by-external-id/[externalId]/route";
import * as invoicesRoute from "../../app/api/v1/invoices/route";
import * as meRoute from "../../app/api/v1/me/route";
import * as vehiclesRoute from "../../app/api/v1/vehicles/route";
import * as endpointsRoute from "../../app/api/v1/webhook-endpoints/route";
import * as openapiRoute from "../../app/api/v1/openapi.json/route";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "../routers/_app";
import { setPublicApiClock } from "./http";
import { MemoryRateLimitStore, setRateLimitStore } from "./rateLimit";
import { setWebhookTransport, webhookDeliveryDeps } from "./webhooks";

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;

// Horloge figée : 20/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-20T10:00:00.000Z");
const MIN = 60_000;
const users: string[] = [];

async function member(organizationId: string, role: "OWNER" | "ADVISOR") {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(2).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.com`,
    },
  });
  users.push(user.id);
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
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
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.77" },
  });
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

// Route handler quel que soit le type de ses paramètres (contexte passé tel quel).
type Handler = (req: Request, ctx: never) => Promise<Response>;

async function call(
  handler: Handler,
  key: string | null,
  init: {
    method?: string;
    path: string;
    body?: unknown;
    idem?: string;
    params?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = { "x-forwarded-for": "41.202.10.77" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idem) headers["idempotency-key"] = init.idem;
  const req = new Request(`http://localhost${init.path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(init.params ?? {}) } as never);
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    // Corps JSON libre de l'API (assertions par toMatchObject) : typage volontairement lâche.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: text ? (JSON.parse(text) as any) : null,
  };
}

describe("étape 6.4 — API publique v1 et webhooks sortants", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let orgB: { id: string };
  let owner: Caller;
  let advisor: Caller;
  let ownerB: Caller;
  let keyA: string;
  let keyB: string;
  let readOnlyKey: string;
  const sent: WebhookRequest[] = [];
  let respond: (r: WebhookRequest) => {
    status: number | null;
    body: string | null;
    error: string | null;
  };

  beforeAll(async () => {
    setPublicApiClock(fixedClock(NOW));
    setRateLimitStore(new MemoryRateLimitStore());
    setWebhookTransport({
      async send(request) {
        sent.push(request);
        return respond(request);
      },
    });
    // Offre PRO : API en écriture (M15 RG-M15-19) ; l'offre STARTER est testée à part.
    orgA = await adminDb.organization.create({
      data: { name: "Garage API A", onboardingCompletedAt: NOW, plan: "PRO" },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage API B", onboardingCompletedAt: NOW, plan: "PRO" },
    });
    orgIds.push(orgA.id, orgB.id);
    owner = await member(orgA.id, "OWNER");
    advisor = await member(orgA.id, "ADVISOR");
    ownerB = await member(orgB.id, "OWNER");
    keyA = (
      await owner.apiKeys.create({
        name: "ERP comptable",
        environment: "live",
        scopes: [
          "customers:read",
          "customers:write",
          "vehicles:read",
          "vehicles:write",
          "invoices:read",
          "webhooks:manage",
        ],
        siteIds: [],
      })
    ).key;
    readOnlyKey = (
      await owner.apiKeys.create({
        name: "Lecture",
        environment: "test",
        scopes: ["customers:read"],
        siteIds: [],
      })
    ).key;
    keyB = (
      await ownerB.apiKeys.create({
        name: "ERP B",
        environment: "live",
        scopes: ["customers:read", "customers:write", "invoices:read"],
        siteIds: [],
      })
    ).key;
  });

  beforeEach(() => {
    sent.length = 0;
    respond = () => ({ status: 200, body: "ok", error: null });
  });

  afterAll(async () => {
    setPublicApiClock(null);
    setRateLimitStore(null);
    setWebhookTransport(null);
    const where = { organizationId: { in: orgIds } };
    await adminDb.webhookDelivery.deleteMany({ where });
    await adminDb.webhookEndpoint.deleteMany({ where });
    await adminDb.idempotencyKey.deleteMany({ where });
    await adminDb.apiRequestLog.deleteMany({ where });
    await adminDb.externalRef.deleteMany({ where });
    await adminDb.dataSource.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.apiKey.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("clés : permission integration:manage, clé montrée une fois, seul le sha256 est stocké", async () => {
    await expect(advisor.apiKeys.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(keyA).toMatch(/^ak_live_[0-9A-Za-z]{32}$/);
    expect(readOnlyKey).toMatch(/^ak_test_/);
    const listed = await owner.apiKeys.list();
    expect(JSON.stringify(listed)).not.toContain(keyA);
    expect(listed.keys.find((k) => k.name === "ERP comptable")).toMatchObject({
      prefix: `${keyA.slice(0, 12)}…`,
      environment: "live",
    });
    const stored = await adminDb.apiKey.findFirstOrThrow({ where: { name: "ERP comptable" } });
    expect(stored.keyHash).toHaveLength(64);
    expect(stored.keyHash).not.toContain(keyA.slice(8));
    await expect(
      owner.apiKeys.create({
        name: "Inconnue",
        environment: "live",
        scopes: ["admin:all"],
        siteIds: [],
      }),
    ).rejects.toThrow(/Scope inconnu/);
  });

  it("authentification : absente, mal formée ou inconnue → 401 ; scope manquant → 403", async () => {
    expect((await call(meRoute.GET, null, { path: "/api/v1/me" })).json).toMatchObject({
      error: { code: "invalid_api_key" },
    });
    expect((await call(meRoute.GET, "ak_live_bad", { path: "/api/v1/me" })).status).toBe(401);
    expect(
      (await call(meRoute.GET, `ak_live_${"A".repeat(32)}`, { path: "/api/v1/me" })).status,
    ).toBe(401);
    const me = await call(meRoute.GET, keyA, { path: "/api/v1/me" });
    expect(me).toMatchObject({
      status: 200,
      json: {
        organization: { id: orgA.id, name: "Garage API A" },
        api_key: { name: "ERP comptable", environment: "live" },
        rate_limit: { requests_per_minute: 300 },
      },
    });
    const forbidden = await call(customersRoute.POST, readOnlyKey, {
      method: "POST",
      path: "/api/v1/customers",
      body: { last_name: "Test" },
      idem: "k-forbidden",
    });
    expect(forbidden).toMatchObject({
      status: 403,
      json: { error: { code: "insufficient_scope" } },
    });
  });

  it("POST client : Idempotency-Key obligatoire, rejeu sans doublon, corps différent → 422", async () => {
    const body = {
      type: "INDIVIDUAL",
      last_name: "Kouassi",
      first_name: "Jean-Marc",
      phone: "07 47 21 88 90",
    };
    const missing = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body,
    });
    expect(missing).toMatchObject({
      status: 400,
      json: { error: { code: "idempotency_key_required" } },
    });
    const created = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { ...body, external_id: "CLI-0042" },
      idem: "create-kouassi",
    });
    expect(created).toMatchObject({
      status: 201,
      json: {
        display_name: "Kouassi Jean-Marc",
        phone: "+2250747218890",
        origin: "api",
        external_id: "CLI-0042",
      },
    });
    const replay = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { ...body, external_id: "CLI-0042" },
      idem: "create-kouassi",
    });
    expect(replay).toMatchObject({ status: 201, json: { id: created.json.id } });
    expect(
      await adminDb.customer.count({ where: { organizationId: orgA.id, lastName: "Kouassi" } }),
    ).toBe(1);
    const reused = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { ...body, last_name: "Autre" },
      idem: "create-kouassi",
    });
    expect(reused).toMatchObject({
      status: 422,
      json: { error: { code: "idempotency_key_reused" } },
    });
    // Le même external_id en POST → 409 (upsert par PUT).
    const dup = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { ...body, external_id: "CLI-0042" },
      idem: "create-again",
    });
    expect(dup.status).toBe(409);
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "customer.created" },
      }),
    ).toBe(1);
  });

  it("validation : erreurs 422 détaillées en français, téléphone invalide", async () => {
    const res = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { type: "COMPANY", phone: "123" },
      idem: "invalid-1",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("validation_failed");
    const phone = await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { last_name: "Yao", phone: "0000000" },
      idem: "invalid-2",
    });
    expect(phone).toMatchObject({
      status: 422,
      json: { error: { message: "Téléphone invalide." } },
    });
  });

  it("PUT by-external-id : crée puis met à jour le même client ; PATCH et lecture", async () => {
    const first = await call(byExternalRoute.PUT, keyA, {
      method: "PUT",
      path: "/api/v1/customers/by-external-id/CLI-0100",
      body: { last_name: "Bamba", first_name: "Aminata" },
      params: { externalId: "CLI-0100" },
    });
    expect(first).toMatchObject({
      status: 201,
      json: { display_name: "Bamba Aminata", external_id: "CLI-0100" },
    });
    const second = await call(byExternalRoute.PUT, keyA, {
      method: "PUT",
      path: "/api/v1/customers/by-external-id/CLI-0100",
      body: { email: "aminata@example.ci" },
      params: { externalId: "CLI-0100" },
    });
    expect(second).toMatchObject({
      status: 200,
      json: { id: first.json.id, email: "aminata@example.ci" },
    });
    const patched = await call(customerRoute.PATCH, keyA, {
      method: "PATCH",
      path: `/api/v1/customers/${first.json.id}`,
      body: { commune: "Yopougon" },
      params: { id: first.json.id },
    });
    expect(patched.json).toMatchObject({ commune: "Yopougon", display_name: "Bamba Aminata" });
    const got = await call(customerRoute.GET, keyA, {
      path: `/api/v1/customers/${first.json.id}`,
      params: { id: first.json.id },
    });
    expect(got.json).toMatchObject({ external_id: "CLI-0100", commune: "Yopougon" });
  });

  it("pagination par curseur, filtre updated_since et phone", async () => {
    for (const name of ["Coulibaly", "Diallo", "Ehui"]) {
      await call(customersRoute.POST, keyA, {
        method: "POST",
        path: "/api/v1/customers",
        body: { last_name: name },
        idem: `page-${name}`,
      });
    }
    const all = await adminDb.customer.count({
      where: { organizationId: orgA.id, deletedAt: null },
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await call(customersRoute.GET, keyA, {
        path: `/api/v1/customers?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      });
      expect(page.status).toBe(200);
      expect(page.json.data.length).toBeLessThanOrEqual(2);
      seen.push(...page.json.data.map((c: { id: string }) => c.id));
      cursor = page.json.next_cursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(all);
    const byPhone = await call(customersRoute.GET, keyA, {
      path: "/api/v1/customers?phone=0747218890",
    });
    expect(byPhone.json.data.map((c: { last_name: string }) => c.last_name)).toEqual(["Kouassi"]);
    const future = await call(customersRoute.GET, keyA, {
      path: "/api/v1/customers?updated_since=2099-01-01T00:00:00Z",
    });
    expect(future.json).toEqual({ data: [], next_cursor: null });
    expect(
      (await call(customersRoute.GET, keyA, { path: "/api/v1/customers?cursor=zzz" })).status,
    ).toBe(400);
  });

  it("véhicules : création (plaque normalisée), doublon 409 ; factures et solde", async () => {
    const customer = await adminDb.customer.findFirstOrThrow({
      where: { organizationId: orgA.id, lastName: "Kouassi" },
    });
    const vehicle = await call(vehiclesRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/vehicles",
      body: {
        customer_id: customer.id,
        plate: "2547 gh 01",
        make: "Toyota",
        model: "Corolla",
        inspection_expiry_date: "2026-12-15",
      },
      idem: "veh-1",
    });
    expect(vehicle).toMatchObject({
      status: 201,
      json: { plate: "2547 GH 01", inspection_expiry_date: "2026-12-15" },
    });
    const dup = await call(vehiclesRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/vehicles",
      body: { customer_id: customer.id, plate: "2547GH01", make: "Toyota", model: "Yaris" },
      idem: "veh-2",
    });
    expect(dup.status).toBe(409);
    const site = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        customerId: customer.id,
        number: "FAC-2026-000412",
        status: "PARTIALLY_PAID",
        issuedAt: NOW,
        dueDate: new Date("2026-11-19"),
        subtotal: 185_000,
        total: 185_000,
        amountPaid: 100_000,
        balance: 85_000,
      },
    });
    const invoices = await call(invoicesRoute.GET, keyA, {
      path: "/api/v1/invoices?status=partially_paid",
    });
    expect(invoices.json.data).toEqual([
      expect.objectContaining({
        number: "FAC-2026-000412",
        total: 185_000,
        balance: 85_000,
        due_date: "2026-11-19",
      }),
    ]);
    const balance = await call(balanceRoute.GET, keyA, {
      path: `/api/v1/customers/${customer.id}/balance`,
      params: { id: customer.id },
    });
    expect(balance.json).toMatchObject({
      balance: 85_000,
      open_invoices: [{ number: "FAC-2026-000412" }],
    });
  });

  it("isolation : la clé de B ne voit ni ne modifie rien de A", async () => {
    const customer = await adminDb.customer.findFirstOrThrow({
      where: { organizationId: orgA.id, lastName: "Kouassi" },
    });
    const got = await call(customerRoute.GET, keyB, {
      path: `/api/v1/customers/${customer.id}`,
      params: { id: customer.id },
    });
    expect(got.status).toBe(404);
    const patch = await call(customerRoute.PATCH, keyB, {
      method: "PATCH",
      path: `/api/v1/customers/${customer.id}`,
      body: { commune: "Pirate" },
      params: { id: customer.id },
    });
    expect(patch.status).toBe(404);
    const listB = await call(customersRoute.GET, keyB, { path: "/api/v1/customers" });
    expect(listB.json.data).toEqual([]);
    expect((await call(invoicesRoute.GET, keyB, { path: "/api/v1/invoices" })).json.data).toEqual(
      [],
    );
    // L'external_id est propre à chaque organisation.
    const b = await call(byExternalRoute.PUT, keyB, {
      method: "PUT",
      path: "/api/v1/customers/by-external-id/CLI-0042",
      body: { last_name: "Client B" },
      params: { externalId: "CLI-0042" },
    });
    expect(b.status).toBe(201);
    expect(b.json.id).not.toBe(customer.id);
  });

  it("journal d'accès et lastUsedAt ; clé révoquée → 401 immédiat", async () => {
    const key = await adminDb.apiKey.findFirstOrThrow({ where: { name: "ERP comptable" } });
    expect(key.lastUsedAt).toEqual(NOW);
    const logs = await adminDb.apiRequestLog.findMany({ where: { apiKeyId: key.id } });
    expect(logs.length).toBeGreaterThan(5);
    expect(
      logs.some((l) => l.status === 201 && l.method === "POST" && l.path === "/api/v1/customers"),
    ).toBe(true);
    expect(logs.every((l) => l.ip === "41.202.10.0")).toBe(true);
    const read = await adminDb.apiKey.findFirstOrThrow({ where: { name: "Lecture" } });
    await owner.apiKeys.revoke({ id: read.id });
    expect((await call(meRoute.GET, readOnlyKey, { path: "/api/v1/me" })).status).toBe(401);
  });

  it("offre STARTER (catalogue M15) : 60 requêtes/min, API en lecture seule, 2 clés au plus", async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const orgC = await adminDb.organization.create({
      data: { name: "Garage API STARTER", onboardingCompletedAt: NOW, plan: "STARTER" },
    });
    orgIds.push(orgC.id);
    const ownerC = await member(orgC.id, "OWNER");
    await expect(
      ownerC.apiKeys.create({
        name: "Écriture",
        environment: "live",
        scopes: ["customers:write"],
        siteIds: [],
      }),
    ).rejects.toThrow(/lecture seule/);
    const key = (
      await ownerC.apiKeys.create({
        name: "Débit",
        environment: "live",
        scopes: ["customers:read"],
        siteIds: [],
      })
    ).key;
    await ownerC.apiKeys.create({
      name: "Deuxième",
      environment: "live",
      scopes: ["customers:read"],
      siteIds: [],
    });
    await expect(
      ownerC.apiKeys.create({
        name: "Troisième",
        environment: "live",
        scopes: ["customers:read"],
        siteIds: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    let last;
    for (let i = 0; i < 60; i++) last = await call(meRoute.GET, key, { path: "/api/v1/me" });
    expect(last).toMatchObject({ status: 200, json: { rate_limit: { requests_per_minute: 60 } } });
    expect(last!.headers.get("x-ratelimit-remaining")).toBe("0");
    const limited = await call(meRoute.GET, key, { path: "/api/v1/me" });
    expect(limited).toMatchObject({ status: 429, json: { error: { code: "rate_limited" } } });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Une autre clé n'est pas affectée.
    expect((await call(meRoute.GET, keyA, { path: "/api/v1/me" })).status).toBe(200);
  });

  it("offre STARTER : une écriture avec une clé héritée est refusée (plan_read_only)", async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const orgC = await adminDb.organization.findFirstOrThrow({
      where: { name: "Garage API STARTER" },
    });
    // Clé créée avant une rétrogradation de PRO à STARTER.
    const { generateApiKey, sha256Hex } = await import("@atelieros/integrations");
    const raw = generateApiKey("live");
    await adminDb.apiKey.create({
      data: {
        organizationId: orgC.id,
        name: "Héritée",
        keyHash: sha256Hex(raw),
        prefix: raw.slice(0, 12),
        scopes: ["customers:write"],
      },
    });
    const res = await call(customersRoute.POST, raw, {
      method: "POST",
      path: "/api/v1/customers",
      body: { last_name: "Interdit" },
      idem: "starter-write",
    });
    expect(res).toMatchObject({ status: 403, json: { error: { code: "plan_read_only" } } });
  });

  it("webhooks : https public obligatoire, secret montré une fois, jamais relu", async () => {
    await expect(
      owner.webhooks.create({ url: "http://erp.garage.ci/hook", events: ["invoice.issued"] }),
    ).rejects.toThrow(/https/);
    await expect(
      owner.webhooks.create({ url: "https://192.168.1.10/hook", events: ["invoice.issued"] }),
    ).rejects.toThrow(/interne/);
    await expect(
      owner.webhooks.create({ url: "https://erp.garage.ci/hook", events: ["foo.bar"] }),
    ).rejects.toThrow(/inconnu/);
    // Créé 30 s après les écritures précédentes : seuls les événements suivants sont diffusés.
    setPublicApiClock(fixedClock(new Date(NOW.getTime() + 30_000)));
    const created = await call(endpointsRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/webhook-endpoints",
      body: {
        url: "https://erp.garage.ci/hooks/atelieros",
        events: ["customer.created", "customer.updated"],
      },
      idem: "wh-1",
    });
    setPublicApiClock(fixedClock(NOW));
    expect(created).toMatchObject({
      status: 201,
      json: { is_active: true, secret: expect.stringMatching(/^whsec_/) },
    });
    const listed = await owner.webhooks.list();
    expect(JSON.stringify(listed)).not.toContain(created.json.secret);
    const row = await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: created.json.id } });
    expect(row.secret).not.toContain(created.json.secret);
  });

  it("diffusion et livraison signée (t=…,v1=…) d'un événement ; pas de doublon au rejeu", async () => {
    const endpoint = await adminDb.webhookEndpoint.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    const secret = (await owner.webhooks.update({ id: endpoint.id, rotateSecret: true })).secret!;
    const later = new Date(NOW.getTime() + MIN);
    setPublicApiClock(fixedClock(later));
    await call(customersRoute.POST, keyA, {
      method: "POST",
      path: "/api/v1/customers",
      body: { last_name: "Konan" },
      idem: "wh-customer",
    });
    setPublicApiClock(fixedClock(NOW));
    const fan = await fanoutWebhookEvents(later, orgA.id);
    expect(fan.deliveries).toBe(1);
    expect((await fanoutWebhookEvents(later, orgA.id)).deliveries).toBe(0);
    const out = await deliverDueWebhooks(webhookDeliveryDeps(), later, orgA.id);
    expect(out).toEqual({ attempted: 1, succeeded: 1 });
    expect(sent).toHaveLength(1);
    const req = sent[0]!;
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      type: "customer.created",
      organization_id: orgA.id,
      data: { origin: "API" },
    });
    expect(body.id).toMatch(/^evt_/);
    expect(req.headers["x-atelieros-event"]).toBe("customer.created");
    const header = req.headers["x-atelieros-signature"]!;
    // Rotation : nouveau secret et ancien secret signent tous deux (24 h).
    expect(header.match(/v1=/g)).toHaveLength(2);
    expect(
      verifyWebhookSignatureHeader({
        header,
        nowSeconds: Math.floor(later.getTime() / 1000),
        expected: (t) => webhookHmac(secret, t, req.body),
      }),
    ).toBe(true);
    const delivery = await adminDb.webhookDelivery.findFirstOrThrow({
      where: { endpointId: endpoint.id },
    });
    expect(delivery).toMatchObject({
      status: "SUCCEEDED",
      attempt: 1,
      responseCode: 200,
      deliveredAt: later,
    });
  });

  it("échecs : reprise à 1 min, abandon après 8 tentatives ; 50 échecs → désactivé et OWNER prévenu", async () => {
    respond = () => ({ status: 503, body: "busy", error: null });
    const endpoint = await adminDb.webhookEndpoint.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    const test = await owner.webhooks.test({ id: endpoint.id });
    expect(test).toMatchObject({ status: "pending", attempt: 1, response_code: 503 });
    const pending = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: test.id } });
    expect(pending.nextAttemptAt).toEqual(new Date(NOW.getTime() + MIN));
    // Pas encore échue : rien n'est tenté.
    expect((await deliverDueWebhooks(webhookDeliveryDeps(), NOW, orgA.id)).attempted).toBe(0);
    let at = NOW;
    for (let attempt = 2; attempt <= 8; attempt++) {
      const row = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: test.id } });
      at = row.nextAttemptAt!;
      await deliverDueWebhooks(webhookDeliveryDeps(), at, orgA.id);
    }
    const failed = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: test.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempt: 8, nextAttemptAt: null });
    // Désactivation au 50e échec consécutif.
    await adminDb.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: 49 },
    });
    await owner.webhooks.test({ id: endpoint.id });
    const disabled = await adminDb.webhookEndpoint.findUniqueOrThrow({
      where: { id: endpoint.id },
    });
    expect(disabled).toMatchObject({ isActive: false, consecutiveFailures: 50 });
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "webhook.endpoint_disabled" },
      }),
    ).toBe(1);
    // Réactivation : compteur remis à zéro ; relivraison manuelle réussie.
    respond = () => ({ status: 204, body: "", error: null });
    await owner.webhooks.update({ id: endpoint.id, isActive: true });
    const redelivered = await owner.webhooks.redeliver({ id: test.id });
    expect(redelivered).toMatchObject({ status: "succeeded", response_code: 204 });
    expect(
      await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } }),
    ).toMatchObject({ consecutiveFailures: 0, isActive: true });
  });

  it("isolation des webhooks : B ne voit ni ne teste les webhooks de A", async () => {
    const endpoint = await adminDb.webhookEndpoint.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    await expect(ownerB.webhooks.test({ id: endpoint.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(ownerB.webhooks.deliveries({ id: endpoint.id, limit: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await ownerB.webhooks.list()).endpoints).toEqual([]);
    const forbidden = await call(endpointsRoute.GET, keyB, { path: "/api/v1/webhook-endpoints" });
    expect(forbidden.status).toBe(403);
  });

  it("OpenAPI 3.1 publique, sans authentification", async () => {
    const res = openapiRoute.GET();
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/customers",
        "/customers/by-external-id/{external_id}",
        "/webhook-endpoints",
      ]),
    );
  });
});
