// M14 US-M14-08 / US-M14-09 / RG-M14-22 — « Mon espace » : accès par OTP téléphone (6 chiffres,
// 5 min, 5 essais, 3 envois/heure), session portail de 30 jours (cookie httpOnly), vue de tous
// les documents des clients de **ce garage** ayant ce numéro, et vue flotte des entreprises dont
// un contact a `portalAccess = true`. Les droits sont recalculés à chaque requête : un contact
// retiré (`portalAccess = false`) perd l'accès immédiatement (§11).
import { createHash, createHmac, randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  businessDate,
  canSendPortalOtp,
  checkPortalOtp,
  deadlineStatus,
  isQuoteAwaitingDecision,
  maskPhone,
  normalizePhoneCI,
  PORTAL_OTP_NEUTRAL_MESSAGE,
  PORTAL_OTP_TTL_MS,
  portalOtpFromRandom,
  portalOtpMessage,
  portalSessionExpiry,
  portalSettingsFrom,
  PORTAL_VISIBLE_INVOICE_STATUSES,
  PORTAL_VISIBLE_QUOTE_STATUSES,
} from "@atelieros/core";
import {
  adminDb,
  db,
  generatePortalToken,
  hashPortalToken,
  logPortalAccess,
  type PortalSession,
} from "@atelieros/db";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { PORTAL_SESSION_COOKIE_NAME } from "../session-cookie-name";
import { guardPortalRequest, type PortalRequestCtx } from "./access";
import { ensureChildToken } from "./links";

const isSecure = () => (process.env.APP_URL ?? "").startsWith("https://");

export function buildPortalSessionCookie(token: string, expiresAt: Date): string {
  const secure = isSecure() ? "; Secure" : "";
  return `${PORTAL_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

export function clearPortalSessionCookie(): string {
  const secure = isSecure() ? "; Secure" : "";
  return `${PORTAL_SESSION_COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

function e164(phone: string): string | null {
  try {
    return normalizePhoneCI(phone).e164;
  } catch {
    return null;
  }
}

function codeHash(organizationId: string, phone: string, code: string): string {
  return createHash("sha256").update(`${organizationId}:${phone}:${code}`).digest("hex");
}

async function orgBySlug(slug: string) {
  const org = await adminDb.organization.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { id: true, name: true, settings: true, timezone: true },
  });
  if (!org) return null;
  const settings = portalSettingsFrom(org.settings);
  return settings.enabled && settings.otpLoginEnabled ? org : null;
}

type TenantDb = ReturnType<typeof db.forTenant>;

/** Clients accessibles à un numéro : particuliers (téléphones) et entreprises (contact autorisé). */
async function accessibleCustomers(tenantDb: TenantDb, phone: string) {
  const [direct, contacts] = await Promise.all([
    tenantDb.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone }, { phone2: phone }, { whatsappPhone: phone }],
      },
      select: { id: true, displayName: true, type: true },
    }),
    tenantDb.customerContact.findMany({
      where: {
        deletedAt: null,
        portalAccess: true,
        OR: [{ phone }, { phone2: phone }],
        customer: { deletedAt: null },
      },
      select: { customer: { select: { id: true, displayName: true, type: true } } },
    }),
  ]);
  const byId = new Map<string, { id: string; displayName: string; type: string; fleet: boolean }>();
  for (const c of direct) byId.set(c.id, { ...c, fleet: false });
  for (const { customer } of contacts) {
    byId.set(customer.id, { ...customer, fleet: true });
  }
  return [...byId.values()];
}

/** `portal.auth.requestOtp` — réponse identique que le numéro soit connu ou non. */
export async function requestPortalOtp(
  input: { orgSlug: string; phone: string },
  ctx: PortalRequestCtx,
  now: Date,
): Promise<{ ok: true; message: string }> {
  await guardPortalRequest(ctx, now);
  const neutral = { ok: true as const, message: PORTAL_OTP_NEUTRAL_MESSAGE };
  const org = await orgBySlug(input.orgSlug);
  const phone = e164(input.phone);
  if (!org || !phone) return neutral;
  const tenantDb = db.forTenant({ organizationId: org.id });
  const sentLastHour = await tenantDb.portalOtpChallenge.count({
    where: { phone, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
  });
  if (!canSendPortalOtp(sentLastHour)) return neutral;
  const customers = await accessibleCustomers(tenantDb, phone);
  if (customers.length === 0) return neutral;
  const code = portalOtpFromRandom(randomInt(0, 1_000_000));
  const challenge = await tenantDb.portalOtpChallenge.create({
    data: {
      organizationId: org.id,
      phone,
      codeHash: codeHash(org.id, phone, code),
      expiresAt: new Date(now.getTime() + PORTAL_OTP_TTL_MS),
      createdAt: now,
    },
  });
  // Canaux du garage (M11) : WhatsApp, repli SMS ; message transactionnel.
  const result = await tenantDb.transaction((tx) =>
    messagingEnqueue(tx, org.id, {
      idempotencyKey: `portal:otp:${challenge.id}`,
      kind: "transactional",
      customerId: customers[0]!.id,
      to: { phone, whatsapp: phone },
      channels: ["WHATSAPP", "SMS"],
      bodyOverride: portalOtpMessage(org.name, code),
    }),
  );
  if ("message" in result) await enqueueMessageSendJob(result.message.id).catch(() => undefined);
  return neutral;
}

/** `portal.auth.verifyOtp` — ouvre une session portail (cookie) sur un code valide. */
export async function verifyPortalOtp(
  input: { orgSlug: string; phone: string; code: string },
  ctx: PortalRequestCtx & { resHeaders: Headers },
  now: Date,
): Promise<{ ok: true }> {
  await guardPortalRequest(ctx, now);
  const invalid = () => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Code invalide ou expiré. Demandez un nouveau code.",
    });
  };
  const org = await orgBySlug(input.orgSlug);
  const phone = e164(input.phone);
  if (!org || !phone) invalid();
  const tenantDb = db.forTenant({ organizationId: org!.id });
  const challenge = await tenantDb.portalOtpChallenge.findFirst({
    where: { phone: phone!, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) invalid();
  const matches = challenge!.codeHash === codeHash(org!.id, phone!, input.code);
  const verdict = checkPortalOtp(challenge!, matches, now);
  if (verdict === "INVALID") {
    await tenantDb.portalOtpChallenge.update({
      where: { id: challenge!.id },
      data: { attempts: { increment: 1 } },
    });
  }
  if (verdict !== "OK") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        verdict === "LOCKED"
          ? "Trop d'essais. Demandez un nouveau code."
          : "Code invalide ou expiré. Demandez un nouveau code.",
    });
  }
  const { token, tokenHash } = generatePortalToken();
  const expiresAt = portalSessionExpiry(now);
  const session = await tenantDb.transaction(async (tx) => {
    await tx.portalOtpChallenge.update({
      where: { id: challenge!.id },
      data: { consumedAt: now },
    });
    return tx.portalSession.create({
      data: { organizationId: org!.id, phone: phone!, tokenHash, expiresAt, lastSeenAt: now },
    });
  });
  await logPortalAccess({
    organizationId: org!.id,
    portalSessionId: session.id,
    access: { action: "otp_login", ip: ctx.ip, userAgent: ctx.userAgent },
  });
  ctx.resHeaders.append("Set-Cookie", buildPortalSessionCookie(token, expiresAt));
  return { ok: true };
}

/** Session portail active depuis le cookie, sinon UNAUTHORIZED. */
export async function requirePortalSession(
  sessionToken: string | null | undefined,
  now: Date,
): Promise<PortalSession> {
  const unauthorized = () => {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PORTAL_SESSION_REQUIRED : connectez-vous avec votre numéro de téléphone.",
    });
  };
  if (!sessionToken) unauthorized();
  const session = await adminDb.portalSession.findUnique({
    where: { tokenHash: hashPortalToken(sessionToken!) },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) unauthorized();
  await adminDb.portalSession.update({ where: { id: session!.id }, data: { lastSeenAt: now } });
  return session!;
}

export async function logoutPortalSession(
  sessionToken: string | null | undefined,
  resHeaders: Headers,
  now: Date,
): Promise<{ ok: true }> {
  if (sessionToken) {
    await adminDb.portalSession.updateMany({
      where: { tokenHash: hashPortalToken(sessionToken), revokedAt: null },
      data: { revokedAt: now },
    });
  }
  resHeaders.append("Set-Cookie", clearPortalSessionCookie());
  return { ok: true };
}

/** Référence opaque d'un document pour une session (aucun identifiant interne exposé). */
function refFor(sessionToken: string, kind: string, id: string): string {
  return createHmac("sha256", sessionToken).update(`account:${kind}:${id}`).digest("base64url");
}

async function accountData(session: PortalSession) {
  const tenantDb = db.forTenant({ organizationId: session.organizationId });
  const customers = await accessibleCustomers(tenantDb, session.phone);
  const ids = customers.map((c) => c.id);
  const [vehicles, quotes, invoices, appointments, orders] = await Promise.all([
    tenantDb.vehicle.findMany({
      where: { customerId: { in: ids }, deletedAt: null },
      orderBy: { plate: "asc" },
      select: {
        id: true,
        customerId: true,
        plate: true,
        make: true,
        model: true,
        fleetNumber: true,
        driverName: true,
        estimatedMileage: true,
        currentMileage: true,
        inspectionExpiryDate: true,
        nextServiceDueDate: true,
      },
    }),
    tenantDb.quote.findMany({
      where: {
        customerId: { in: ids },
        deletedAt: null,
        supersededAt: null,
        status: { in: [...PORTAL_VISIBLE_QUOTE_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        customerId: true,
        number: true,
        version: true,
        status: true,
        total: true,
        validUntil: true,
        createdAt: true,
      },
    }),
    tenantDb.invoice.findMany({
      where: { customerId: { in: ids }, status: { in: [...PORTAL_VISIBLE_INVOICE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        customerId: true,
        number: true,
        externalNumber: true,
        status: true,
        total: true,
        balance: true,
        issuedAt: true,
      },
    }),
    tenantDb.appointment.findMany({
      where: { customerId: { in: ids }, status: { in: ["BOOKED", "CONFIRMED"] } },
      orderBy: { startsAt: "asc" },
      take: 20,
      select: { id: true, customerId: true, startsAt: true, status: true, type: true },
    }),
    tenantDb.repairOrder.findMany({
      where: {
        customerId: { in: ids },
        deletedAt: null,
        status: { notIn: ["DELIVERED", "INVOICED", "CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, customerId: true, vehicleId: true, number: true, status: true },
    }),
  ]);
  return { customers, vehicles, quotes, invoices, appointments, orders };
}

/** `portal.account.overview` — données de toutes les fiches du numéro, références opaques. */
export async function accountOverview(sessionToken: string, session: PortalSession, now: Date) {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { name: true, phone: true, timezone: true },
  });
  const today = businessDate(now, org.timezone);
  const data = await accountData(session);
  const nameOf = new Map(data.customers.map((c) => [c.id, c.displayName]));
  const openOrderOf = new Map(data.orders.map((o) => [o.vehicleId, o]));
  return {
    garage: { name: org.name, phone: org.phone },
    phone: maskPhone(session.phone),
    accounts: data.customers.map((c) => ({
      name: c.displayName,
      fleet: c.fleet,
      balance: data.invoices
        .filter((i) => i.customerId === c.id)
        .reduce((sum, i) => sum + i.balance, 0),
    })),
    vehicles: data.vehicles.map((v) => {
      const order = openOrderOf.get(v.id);
      return {
        ref: refFor(sessionToken, "vehicle", v.id),
        account: nameOf.get(v.customerId) ?? "",
        plate: v.plate,
        label: `${v.make} ${v.model}`,
        fleetNumber: v.fleetNumber,
        driverName: v.driverName,
        mileage: v.estimatedMileage ?? v.currentMileage,
        inspection: {
          date: v.inspectionExpiryDate,
          ...deadlineStatus(v.inspectionExpiryDate, today),
        },
        service: { date: v.nextServiceDueDate, ...deadlineStatus(v.nextServiceDueDate, today) },
        openOrder: order
          ? {
              ref: refFor(sessionToken, "repair_order", order.id),
              number: order.number,
              status: order.status,
            }
          : null,
      };
    }),
    quotes: data.quotes.map((q) => ({
      ref: refFor(sessionToken, "quote", q.id),
      account: nameOf.get(q.customerId) ?? "",
      number: q.version > 1 ? `${q.number} v${q.version}` : q.number,
      status: q.status,
      total: q.total,
      awaitingDecision: isQuoteAwaitingDecision(q.status),
      date: q.createdAt,
    })),
    invoices: data.invoices.map((i) => ({
      ref: refFor(sessionToken, "invoice", i.id),
      account: nameOf.get(i.customerId) ?? "",
      number: i.externalNumber ?? i.number ?? "",
      status: i.status,
      total: i.total,
      balance: i.balance,
      date: i.issuedAt,
    })),
    appointments: data.appointments.map((a) => ({
      ref: refFor(sessionToken, "appointment", a.id),
      account: nameOf.get(a.customerId) ?? "",
      startsAt: a.startsAt,
      status: a.status,
      type: a.type,
    })),
  };
}

/** `portal.account.open` — URL du document (jeton enfant de la session), après contrôle d'accès. */
export async function openAccountDocument(
  sessionToken: string,
  session: PortalSession,
  input: { kind: "vehicle" | "quote" | "invoice" | "repair_order" | "appointment"; ref: string },
  ctx: PortalRequestCtx,
  now: Date,
): Promise<{ url: string }> {
  const data = await accountData(session);
  const notFound = () => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document introuvable." });
  };
  const match = <T extends { id: string }>(rows: T[]) =>
    rows.find((r) => refFor(sessionToken, input.kind, r.id) === input.ref);
  const base = { parentToken: sessionToken, organizationId: session.organizationId, now };
  let out: { url: string } | null = null;
  if (input.kind === "vehicle") {
    const v = match(data.vehicles);
    if (v)
      out = await ensureChildToken({
        ...base,
        scope: "VEHICLE",
        targetId: v.id,
        customerId: v.customerId,
        refs: {},
      });
  } else if (input.kind === "quote") {
    const q = match(data.quotes);
    if (q) {
      out = await ensureChildToken({
        ...base,
        scope: "QUOTE",
        targetId: q.id,
        customerId: q.customerId,
        refs: { validUntil: q.validUntil },
      });
    }
  } else if (input.kind === "invoice") {
    const i = match(data.invoices);
    if (i) {
      out = await ensureChildToken({
        ...base,
        scope: "INVOICE",
        targetId: i.id,
        customerId: i.customerId,
        refs: { issuedAt: i.issuedAt },
      });
    }
  } else if (input.kind === "repair_order") {
    const o = match(data.orders);
    if (o)
      out = await ensureChildToken({
        ...base,
        scope: "REPAIR_ORDER",
        targetId: o.id,
        customerId: o.customerId,
        refs: {},
      });
  } else {
    const a = match(data.appointments);
    if (a) {
      out = await ensureChildToken({
        ...base,
        scope: "APPOINTMENT",
        targetId: a.id,
        customerId: a.customerId,
        refs: { startsAt: a.startsAt },
      });
    }
  }
  if (!out) notFound();
  await logPortalAccess({
    organizationId: session.organizationId,
    portalSessionId: session.id,
    access: { action: "document_open", ip: ctx.ip, userAgent: ctx.userAgent },
  });
  return out!;
}
