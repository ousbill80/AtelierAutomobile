// M14 §12 — intégration du portail client (étape 6.3) : espace OR et documents enfants, portée
// stricte des jetons, isolation multi-locataire, journal PortalAccess, renvoi de lien (3/jour),
// révocation, limitation de débit et blocage IP, avis, OTP « Mon espace », lien court, SSE.
import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, findForbiddenKeys, fixedClock } from "@atelieros/core";
import { adminDb, hashPortalToken, issuePortalToken } from "@atelieros/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as shortLinkGET } from "@/app/l/[code]/route";
import { GET as eventsGET } from "@/app/p/[token]/events/route";
import { createContext } from "../context";
import { setPortalClock } from "../portal/access";
import { resetPortalRateLimits } from "../portal/rateLimit";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// Pas de Redis dans les tests : le job d'envoi (après commit) est simulé.
vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);

const NOW = new Date("2026-10-20T09:00:00.000Z");
const DAY = 86_400_000;
const UA = "Mozilla/5.0 (Linux; Android 10) Chrome/118 Mobile";

async function anonymous(ip: string, cookie?: string) {
  const resHeaders = new Headers();
  const req = new Request("http://localhost/api/trpc", {
    headers: { "user-agent": UA, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
  });
  const ctx = await createContext({ req, resHeaders, info: undefined as never });
  return { caller: callerFactory(ctx), resHeaders };
}

async function staff(organizationId: string, role: "OWNER" | "ADVISOR" | "MECHANIC") {
  const user = await adminDb.user.create({
    data: { name: role, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
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
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "10.0.0.1" },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { caller: callerFactory(ctx), membershipId: membership.id, userId: user.id };
}

interface Fixture {
  org: { id: string };
  site: { id: string };
  customer: { id: string };
  vehicle: { id: string };
  order: { id: string };
  quote: { id: string };
  invoice: { id: string };
  owner: Awaited<ReturnType<typeof staff>>;
}

async function fixture(name: string, phone: string): Promise<Fixture> {
  const org = await adminDb.organization.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: NOW,
      settings: { portal: { googleReviewUrl: "https://g.page/r/garage-test" } },
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: org.id, name: "Yopougon", code: "YOP", phone: "+2252723000000" },
  });
  await adminDb.channelConfig.create({
    data: {
      organizationId: org.id,
      channel: "SMS",
      provider: "console",
      isActive: true,
      credentials: "{}",
    },
  });
  const owner = await staff(org.id, "OWNER");
  const customer = await adminDb.customer.create({
    data: { organizationId: org.id, displayName: "Kouassi Jean-Marc", phone },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      plate: "2547 GH 01",
      plateCompact: "2547GH01",
      make: "Toyota",
      model: "Corolla",
      inspectionExpiryDate: new Date("2026-11-10T00:00:00.000Z"),
    },
  });
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: org.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "IN_PROGRESS",
      mileageIn: 48_200,
    },
  });
  await adminDb.workNote.createMany({
    data: [
      {
        organizationId: org.id,
        repairOrderId: order.id,
        authorId: owner.membershipId,
        body: "Plaquettes remplacées, essai routier OK",
        visibleToCustomer: true,
      },
      {
        organizationId: org.id,
        repairOrderId: order.id,
        authorId: owner.membershipId,
        body: "NOTE INTERNE : client difficile",
        visibleToCustomer: false,
      },
    ],
  });
  await adminDb.attachment.create({
    data: {
      organizationId: org.id,
      entity: "repair_order",
      entityId: order.id,
      kind: "photo_checkin",
      url: `${org.id}/x.webp`,
      mimeType: "image/webp",
      size: 10,
    },
  });
  const quote = await adminDb.quote.create({
    data: {
      organizationId: org.id,
      siteId: site.id,
      number: "DEV-YOP-2026-00017",
      customerId: customer.id,
      vehicleId: vehicle.id,
      repairOrderId: order.id,
      status: "SENT",
      validUntil: new Date("2026-10-30T00:00:00.000Z"),
      total: 179_000,
    },
  });
  const invoice = await adminDb.invoice.create({
    data: {
      organizationId: org.id,
      siteId: site.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      repairOrderId: order.id,
      number: `FAC-2026-${randomBytes(3).toString("hex")}`,
      status: "ISSUED",
      issuedAt: NOW,
      total: 185_000,
      balance: 185_000,
    },
  });
  return { org, site, customer, vehicle, order, quote, invoice, owner };
}

async function token(
  f: Fixture,
  scope: "REPAIR_ORDER" | "QUOTE" | "VEHICLE" | "SURVEY",
  targetId: string,
  expiresAt = new Date(NOW.getTime() + 30 * DAY),
) {
  const issued = await issuePortalToken(adminDb, {
    organizationId: f.org.id,
    scope,
    targetId,
    customerId: f.customer.id,
    expiresAt,
  });
  return issued.token;
}

describe("portail client complet (M14, étape 6.3)", () => {
  let a: Fixture;
  let b: Fixture;
  const users: string[] = [];

  beforeAll(async () => {
    setRepairOrdersClock(fixedClock(NOW));
    setPortalClock(fixedClock(NOW));
    a = await fixture("Garage Portail A", "+2250747218890");
    b = await fixture("Garage Portail B", "+2250747218890");
    users.push(a.owner.userId, b.owner.userId);
  });

  beforeEach(() => resetPortalRateLimits());

  afterAll(async () => {
    const where = { organizationId: { in: [a.org.id, b.org.id] } };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.conversation.deleteMany({ where });
    await adminDb.customerFeedback.deleteMany({ where });
    await adminDb.portalAccess.deleteMany({ where });
    await adminDb.portalSession.deleteMany({ where });
    await adminDb.portalOtpChallenge.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.workNote.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customerContact.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: [a.org.id, b.org.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  });

  it("espace OR : suivi, photos, remarques visibles client seulement, documents, aucune clé interne", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id);
    const { caller } = await anonymous("41.202.219.77");
    const view = await caller.portal.repairOrder.tracking({ token: t });
    expect(view.number).toBe("OR-YOP-2026-00042");
    expect(view.statusLabel).toBe("En réparation");
    expect(view.photos).toHaveLength(1);
    expect(view.notes.map((n) => n.body)).toEqual(["Plaquettes remplacées, essai routier OK"]);
    expect(JSON.stringify(view)).not.toContain("NOTE INTERNE");
    expect(view.documents.map((d) => [d.kind, d.number, d.status])).toEqual([
      ["quote", "DEV-YOP-2026-00017", "SENT"],
      ["invoice", expect.stringMatching(/^FAC-2026-/), "ISSUED"],
    ]);
    expect(findForbiddenKeys(view)).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(a.order.id);
    expect(JSON.stringify(view)).not.toContain(a.customer.id);

    // Journal : ouverture comptée avec IP tronquée /24 ; un rafraîchissement ne compte pas.
    await caller.portal.repairOrder.tracking({ token: t, refresh: true });
    const row = await adminDb.portalToken.findUniqueOrThrow({
      where: { tokenHash: hashPortalToken(t) },
      include: { accesses: true },
    });
    expect(row.openCount).toBe(1);
    expect(row.accesses.map((x) => [x.action, x.ipPrefix])).toEqual([["open", "41.202.219.0"]]);
  });

  it("documents enfants : jeton dérivé stable, lit le devis et la facture de l'OR, rien d'autre", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id);
    const { caller } = await anonymous("41.202.1.1");
    const first = await caller.portal.repairOrder.openDocument({
      token: t,
      kind: "quote",
      index: 0,
    });
    const again = await caller.portal.repairOrder.openDocument({
      token: t,
      kind: "quote",
      index: 0,
    });
    expect(again.url).toBe(first.url);
    const child = first.url.match(/\/p\/([^/]+)\/devis$/)![1]!;
    expect(await adminDb.portalToken.count({ where: { tokenHash: hashPortalToken(child) } })).toBe(
      1,
    );
    const quote = await caller.portal.quote.get({ token: child });
    expect(quote.number).toBe("DEV-YOP-2026-00017");

    const inv = await caller.portal.repairOrder.openDocument({
      token: t,
      kind: "invoice",
      index: 0,
    });
    const invToken = inv.url.match(/\/p\/([^/]+)\/facture$/)![1]!;
    const invoiceView = await caller.portal.invoice.get({ token: invToken });
    expect(invoiceView.invoice.balance).toBe(185_000);

    await expect(
      caller.portal.repairOrder.openDocument({ token: t, kind: "quote", index: 5 }),
    ).rejects.toThrow(/introuvable/);
    // Portée stricte : le jeton enfant QUOTE ne lit pas l'OR, le jeton OR ne lit pas le devis.
    await expect(caller.portal.repairOrder.tracking({ token: child })).rejects.toThrow(/Lien/);
    await expect(caller.portal.quote.get({ token: t })).rejects.toThrow(/Lien/);
    await expect(caller.portal.invoice.get({ token: t })).rejects.toThrow(/Lien/);
  });

  it("isolation multi-locataire : un jeton de B ne montre que B, même numéro de téléphone", async () => {
    const tb = await token(b, "REPAIR_ORDER", b.order.id);
    const { caller } = await anonymous("41.202.2.2");
    const view = await caller.portal.repairOrder.tracking({ token: tb });
    expect(view.garage.name).toBe("Garage Portail B");
    const docs = await caller.portal.repairOrder.openDocument({
      token: tb,
      kind: "quote",
      index: 0,
    });
    const child = docs.url.match(/\/p\/([^/]+)\/devis$/)![1]!;
    const row = await adminDb.portalToken.findUniqueOrThrow({
      where: { tokenHash: hashPortalToken(child) },
    });
    expect(row.organizationId).toBe(b.org.id);
    expect(row.targetId).toBe(b.quote.id);
    // Un jeton de A ciblant une ressource de B (forgé) ne lit rien : RLS + organisation du jeton.
    const forged = await issuePortalToken(adminDb, {
      organizationId: a.org.id,
      scope: "REPAIR_ORDER",
      targetId: b.order.id,
      customerId: a.customer.id,
      expiresAt: new Date(NOW.getTime() + DAY),
    });
    await expect(caller.portal.repairOrder.tracking({ token: forged.token })).rejects.toThrow(
      /Lien/,
    );
  });

  it("véhicule : échéances, passages du seul client du jeton, facture et suivi en jetons enfants", async () => {
    const other = await adminDb.customer.create({
      data: { organizationId: a.org.id, displayName: "Ancien propriétaire" },
    });
    await adminDb.repairOrder.create({
      data: {
        organizationId: a.org.id,
        siteId: a.site.id,
        number: "OR-YOP-2025-00001",
        customerId: other.id,
        vehicleId: a.vehicle.id,
        status: "DELIVERED",
      },
    });
    const t = await token(a, "VEHICLE", a.vehicle.id);
    const { caller } = await anonymous("41.202.3.3");
    const view = await caller.portal.vehicle.get({ token: t });
    expect(view.deadlines.inspection).toMatchObject({ state: "SOON", daysLeft: 21 });
    expect(view.deadlines.service.state).toBe("UNKNOWN");
    expect(view.visits).toHaveLength(1);
    expect(view.visits[0]).toMatchObject({ inProgress: true, mileage: 48_200 });
    expect(JSON.stringify(view)).not.toContain("OR-YOP-2025-00001");
    const follow = await caller.portal.vehicle.openDocument({
      token: t,
      kind: "repair_order",
      index: 0,
    });
    expect(follow.url).toMatch(/\/suivi$/);
  });

  it("lien expiré → LINK_EXPIRED ; « nouveau lien » au numéro enregistré, 3 par jour, jamais révélé", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id, new Date(NOW.getTime() - 1000));
    const { caller } = await anonymous("41.202.4.4");
    await expect(caller.portal.repairOrder.tracking({ token: t })).rejects.toThrow(/LINK_EXPIRED/);
    const before = await adminDb.portalToken.count({ where: { organizationId: a.org.id } });
    for (let i = 0; i < 4; i++) {
      expect(await caller.portal.requestNewLink({ token: t })).toEqual({ ok: true });
    }
    const after = await adminDb.portalToken.count({ where: { organizationId: a.org.id } });
    expect(after - before).toBe(3);
    const messages = await adminDb.message.findMany({
      where: { organizationId: a.org.id, idempotencyKey: { startsWith: "portal:newlink:" } },
    });
    expect(messages).toHaveLength(3);
    expect(messages.every((m) => m.to === "+2250747218890")).toBe(true);
    expect(messages[0]!.body).toMatch(/\/l\/[0-9A-Za-z]{8}$/);
    // Jeton inconnu : même réponse, rien de créé.
    expect(await caller.portal.requestNewLink({ token: "z".repeat(43) })).toEqual({ ok: true });
    expect(await adminDb.portalToken.count({ where: { organizationId: a.org.id } })).toBe(after);
  });

  it("révocation : motif + audit, page « lien plus valable » ; permission requise", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id);
    const row = await adminDb.portalToken.findUniqueOrThrow({
      where: { tokenHash: hashPortalToken(t) },
    });
    const mechanic = await staff(a.org.id, "MECHANIC");
    users.push(mechanic.userId);
    await expect(
      mechanic.caller.portalLinks.revoke({ id: row.id, reason: "Lien transféré" }),
    ).rejects.toThrow(/Permission manquante/);
    const list = await a.owner.caller.portalLinks.list({
      scope: "REPAIR_ORDER",
      targetId: a.order.id,
    });
    expect(list.some((l) => l.id === row.id && l.state === "ACTIVE")).toBe(true);
    await a.owner.caller.portalLinks.revoke({ id: row.id, reason: "Lien transféré à un tiers" });
    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: a.org.id, action: "portal.token_revoked", entityId: row.id },
    });
    expect(audit?.reason).toBe("Lien transféré à un tiers");
    const { caller } = await anonymous("41.202.5.5");
    await expect(caller.portal.repairOrder.tracking({ token: t })).rejects.toThrow(/LINK_REVOKED/);
    // Organisation B ne voit pas les liens de A.
    await expect(
      b.owner.caller.portalLinks.revoke({ id: row.id, reason: "test isolation" }),
    ).rejects.toThrow(/introuvable/);
  });

  it("création d'un lien back-office : URL + alias court ; /l/{code} redirige (302) vers la page", async () => {
    const link = await a.owner.caller.portalLinks.create({
      scope: "REPAIR_ORDER",
      targetId: a.order.id,
    });
    expect(link.url).toMatch(/\/p\/[A-Za-z0-9_-]{43}\/suivi$/);
    const code = link.shortUrl!.split("/l/")[1]!;
    const res = await shortLinkGET(new Request(`http://localhost/l/${code}`), {
      params: Promise.resolve({ code }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(link.url);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const missing = await shortLinkGET(
      new Request("http://localhost/l/AAAAAAAA", { headers: { "x-forwarded-for": "9.9.9.9" } }),
      { params: Promise.resolve({ code: "AAAAAAAA" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("limitation : 30 requêtes/min par IP, puis blocage 30 min après 5 jetons invalides", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id);
    const { caller } = await anonymous("41.202.6.6");
    for (let i = 0; i < 30; i++) await caller.portal.repairOrder.tracking({ token: t });
    await expect(caller.portal.repairOrder.tracking({ token: t })).rejects.toThrow(/RATE_LIMITED/);

    const other = await anonymous("41.202.7.7");
    for (let i = 0; i < 5; i++) {
      await expect(
        other.caller.portal.repairOrder.tracking({ token: `${"y".repeat(42)}${i}` }),
      ).rejects.toThrow(/LINK_NOT_FOUND/);
    }
    await expect(other.caller.portal.repairOrder.tracking({ token: t })).rejects.toThrow(
      /30 minutes/,
    );
  });

  it("avis : un seul par OR, gérant prévenu si ≤ 3, avis Google proposé si ≥ 4", async () => {
    await adminDb.repairOrder.update({
      where: { id: b.order.id },
      data: { status: "DELIVERED", deliveredAt: NOW },
    });
    const t = await token(b, "SURVEY", b.order.id);
    const { caller } = await anonymous("41.202.8.8");
    const view = await caller.portal.feedback.get({ token: t });
    expect(view.submitted).toBeNull();
    const low = await caller.portal.feedback.submit({ token: t, rating: 2, comment: "Trop long" });
    expect(low).toEqual({ googleReviewUrl: null, alreadySubmitted: false });
    const notif = await adminDb.notification.findFirst({
      where: { organizationId: b.org.id, type: "portal.feedback_low" },
    });
    expect(notif?.membershipId).toBe(b.owner.membershipId);
    const again = await caller.portal.feedback.submit({ token: t, rating: 5 });
    expect(again.alreadySubmitted).toBe(true);
    expect(await adminDb.customerFeedback.count({ where: { repairOrderId: b.order.id } })).toBe(1);
    const list = await b.owner.caller.feedback.list({ limit: 10 });
    expect(list.items.map((f) => f.rating)).toEqual([2]);
    expect((await a.owner.caller.feedback.list({ limit: 10 })).items).toEqual([]);
    // Un jeton OR ne permet pas de donner un avis (portée SURVEY uniquement).
    const ro = await token(b, "REPAIR_ORDER", b.order.id);
    await expect(caller.portal.feedback.submit({ token: ro, rating: 5 })).rejects.toThrow(/Lien/);
  });

  it("OTP « Mon espace » : réponse neutre, 5 essais, session cookie, documents du seul garage", async () => {
    const slug = (await adminDb.organization.findUniqueOrThrow({ where: { id: a.org.id } })).slug!;
    const { caller } = await anonymous("41.202.9.9");
    const unknown = await caller.portal.auth.requestOtp({ orgSlug: slug, phone: "0102030405" });
    const known = await caller.portal.auth.requestOtp({ orgSlug: slug, phone: "07 47 21 88 90" });
    expect(known).toEqual(unknown);
    expect(await adminDb.portalOtpChallenge.count({ where: { organizationId: a.org.id } })).toBe(1);
    const message = await adminDb.message.findFirstOrThrow({
      where: { organizationId: a.org.id, idempotencyKey: { startsWith: "portal:otp:" } },
    });
    const code = message.body.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(
        caller.portal.auth.verifyOtp({ orgSlug: slug, phone: "0747218890", code: wrong }),
      ).rejects.toThrow(/Code invalide/);
    }
    await expect(
      caller.portal.auth.verifyOtp({ orgSlug: slug, phone: "0747218890", code }),
    ).rejects.toThrow(/Trop d'essais/);

    // Nouveau code (2e envoi de l'heure) puis connexion.
    await adminDb.portalOtpChallenge.deleteMany({ where: { organizationId: a.org.id } });
    await caller.portal.auth.requestOtp({ orgSlug: slug, phone: "0747218890" });
    const second = await adminDb.message.findFirstOrThrow({
      where: { organizationId: a.org.id, idempotencyKey: { startsWith: "portal:otp:" } },
      orderBy: { createdAt: "desc" },
    });
    const code2 = second.body.match(/\b(\d{6})\b/)![1]!;
    const login = await anonymous("41.202.9.10");
    await login.caller.portal.auth.verifyOtp({ orgSlug: slug, phone: "0747218890", code: code2 });
    const cookie = login.resHeaders.get("set-cookie")!;
    expect(cookie).toMatch(/^atelieros_portal=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    const session = await anonymous("41.202.9.11", cookie.split(";")[0]);
    const overview = await session.caller.portal.account.overview();
    expect(overview.garage.name).toBe("Garage Portail A");
    expect(overview.phone).toBe("+225 07 •• •• 88 90");
    expect(overview.invoices.map((i) => i.total)).toEqual([185_000]);
    expect(findForbiddenKeys(overview)).toEqual([]);
    expect(JSON.stringify(overview)).not.toContain(a.invoice.id);
    const opened = await session.caller.portal.account.open({
      kind: "invoice",
      ref: overview.invoices[0]!.ref,
    });
    const invToken = opened.url.match(/\/p\/([^/]+)\/facture$/)![1]!;
    const row = await adminDb.portalToken.findUniqueOrThrow({
      where: { tokenHash: hashPortalToken(invToken) },
    });
    expect(row.targetId).toBe(a.invoice.id);
    await expect(
      session.caller.portal.account.open({ kind: "invoice", ref: "x".repeat(43) }),
    ).rejects.toThrow(/introuvable/);
    // Sans cookie : non autorisé ; après déconnexion : session révoquée.
    await expect(caller.portal.account.overview()).rejects.toThrow(/PORTAL_SESSION_REQUIRED/);
    await session.caller.portal.auth.logout();
    await expect(session.caller.portal.account.overview()).rejects.toThrow(
      /PORTAL_SESSION_REQUIRED/,
    );
  });

  it("vue flotte : un contact entreprise avec portalAccess voit la flotte, retiré il la perd", async () => {
    const company = await adminDb.customer.create({
      data: { organizationId: a.org.id, displayName: "SOTRA Logistique", type: "COMPANY" },
    });
    await adminDb.vehicle.create({
      data: {
        organizationId: a.org.id,
        customerId: company.id,
        plate: "7777 AB 01",
        plateCompact: "7777AB01",
        make: "Toyota",
        model: "Hilux",
        fleetNumber: "F-12",
      },
    });
    const contact = await adminDb.customerContact.create({
      data: {
        organizationId: a.org.id,
        customerId: company.id,
        name: "Responsable flotte",
        phone: "+2250505050505",
        portalAccess: true,
      },
    });
    const sessionToken = randomBytes(32).toString("base64url");
    await adminDb.portalSession.create({
      data: {
        organizationId: a.org.id,
        phone: "+2250505050505",
        tokenHash: hashPortalToken(sessionToken),
        expiresAt: new Date(NOW.getTime() + 30 * DAY),
      },
    });
    const session = await anonymous("41.202.10.1", `atelieros_portal=${sessionToken}`);
    const overview = await session.caller.portal.account.overview();
    expect(overview.accounts).toEqual([{ name: "SOTRA Logistique", fleet: true, balance: 0 }]);
    expect(overview.vehicles.map((v) => v.fleetNumber)).toEqual(["F-12"]);
    await adminDb.customerContact.update({
      where: { id: contact.id },
      data: { portalAccess: false },
    });
    const after = await session.caller.portal.account.overview();
    expect(after.accounts).toEqual([]);
    expect(after.vehicles).toEqual([]);
  });

  it("flux SSE : text/event-stream avec la version initiale ; jeton invalide → 404", async () => {
    const t = await token(a, "REPAIR_ORDER", a.order.id);
    const controller = new AbortController();
    const res = await eventsGET(
      new Request(`http://localhost/p/${t}/events`, {
        headers: { "x-forwarded-for": "41.202.11.1" },
        signal: controller.signal,
      }),
      { params: Promise.resolve({ token: t }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/event: version\ndata: \{"version":"IN_PROGRESS\|/);
    controller.abort();
    await reader.cancel();
    const bad = await eventsGET(new Request("http://localhost/p/x/events"), {
      params: Promise.resolve({ token: "q".repeat(43) }),
    });
    expect(bad.status).toBe(404);
  });
});
