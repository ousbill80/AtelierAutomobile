// M08 §FNE — orchestration de la certification partagée par le worker (`fne.certify`, `fne.retry`)
// et les routeurs (`fne.retry`). Les règles (payload, backoff, classement des erreurs, signalement)
// viennent de `@atelieros/core` ; le fournisseur est injecté (interface FneProvider de
// `@atelieros/integrations`, résolue par l'appelant) pour rester testable sans compte DGI.
//
// Idempotence : (1) la tentative est « réservée » par un `updateMany` conditionné sur
// `fneAttempts` (une seule exécution gagne, même si le job et le balayage tournent ensemble) ;
// (2) `invoice.id` est transmis comme clé d'idempotence à l'adaptateur ; (3) le résultat n'est
// écrit que si la facture n'a pas été certifiée entre-temps (saisie manuelle concurrente).
import {
  buildFnePayload,
  classifyFneError,
  FNE_DEFER_MS,
  FNE_UNCERTIFIED_STATUSES,
  isDomainError,
  isFneAlertDue,
  isFneRetryDue,
  planFneFailure,
  type FneInvoicePayload,
} from "@atelieros/core";
import type { FneStatus, Prisma } from "@prisma/client";
import { writeAuditLog } from "./audit";
import { adminDb } from "./client";
import { db } from "./tenant";

/** Forme structurelle de `FneProvider.certify` (packages/integrations). */
export interface FneCertifier {
  certify(payload: FneInvoicePayload): Promise<{
    fneNumber: string;
    qrCode: string;
    signedAt: Date;
    raw: unknown;
  }>;
}

export type ResolveFneCertifier = (organizationId: string) => Promise<FneCertifier>;

/** Durée pendant laquelle une tentative en cours n'est pas reprise par le balayage. */
const IN_FLIGHT_LEASE_MS = 15 * 60_000;
const UNCERTIFIED: FneStatus[] = [...FNE_UNCERTIFIED_STATUSES] as FneStatus[];

/** `FneConfig` d'une organisation au format `FneConfigRecord` (registre des intégrations). */
export async function loadFneConfigRecord(organizationId: string) {
  const config = await db.forTenant({ organizationId }).fneConfig.findFirst({});
  if (!config) return undefined;
  const mode = config.mode === "api" || config.mode === "disabled" ? config.mode : "manual";
  return {
    mode: mode as "api" | "manual" | "disabled",
    provider: config.provider,
    isActive: config.isActive,
    credentials: config.credentials,
    establishmentId: config.establishmentId,
    pointOfSale: config.pointOfSale,
  };
}

export type FneCertifyOutcome =
  | { outcome: "certified"; fneNumber: string }
  | { outcome: "failed"; kind: "transient" | "rejected"; message: string }
  | { outcome: "deferred"; reason: string }
  | { outcome: "skipped"; reason: string };

/**
 * US-M08-05 / RG-M08-15 — une tentative de certification d'une facture ou d'un avoir émis
 * (`fneStatus` PENDING ou FAILED, mode `api`). Ne lève pas : le résultat est écrit sur la facture.
 */
export async function certifyInvoiceFne(input: {
  organizationId: string;
  invoiceId: string;
  now: Date;
  resolveProvider: ResolveFneCertifier;
}): Promise<FneCertifyOutcome> {
  const { organizationId, invoiceId, now } = input;
  const tenantDb = db.forTenant({ organizationId });
  const config = await tenantDb.fneConfig.findFirst({});
  if (config?.mode !== "api") return { outcome: "skipped", reason: "mode_not_api" };
  const invoice = await tenantDb.invoice.findFirst({ where: { id: invoiceId } });
  if (!invoice || invoice.status === "DRAFT" || !invoice.number) {
    return { outcome: "skipped", reason: "not_issued" };
  }
  if (!UNCERTIFIED.includes(invoice.fneStatus)) {
    return { outcome: "skipped", reason: "already_final" };
  }

  // RG-M08-12 : un avoir référence la FNE de sa facture d'origine, certifiée d'abord.
  let original: { number: string | null; fneNumber: string | null } | null = null;
  if (invoice.type === "CREDIT_NOTE" && invoice.creditedInvoiceId) {
    const source = await tenantDb.invoice.findFirst({
      where: { id: invoice.creditedInvoiceId },
      select: { number: true, fneNumber: true, fneStatus: true },
    });
    if (source && UNCERTIFIED.includes(source.fneStatus)) {
      const reason = `En attente de la certification de la facture d'origine ${source.number ?? ""}.`;
      await tenantDb.invoice.updateMany({
        where: { id: invoice.id, fneStatus: { in: UNCERTIFIED } },
        data: { fneNextRetryAt: new Date(now.getTime() + FNE_DEFER_MS), fneError: reason.trim() },
      });
      return { outcome: "deferred", reason };
    }
    original = source ?? null;
  }

  const [org, customer, lines, allocation] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, legalName: true, ncc: true, taxRegime: true },
    }),
    tenantDb.customer.findFirstOrThrow({ where: { id: invoice.customerId } }),
    tenantDb.invoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    tenantDb.paymentAllocation.findFirst({
      where: { invoiceId: invoice.id, voidedAt: null, paymentId: { not: null } },
      include: { payment: { select: { method: true } } },
      orderBy: { id: "asc" },
    }),
  ]);

  // Réservation de la tentative (idempotence) : seul l'appel qui incrémente `fneAttempts` continue.
  const claimed = await tenantDb.invoice.updateMany({
    where: { id: invoice.id, fneStatus: { in: UNCERTIFIED }, fneAttempts: invoice.fneAttempts },
    data: {
      fneAttempts: { increment: 1 },
      fneNextRetryAt: new Date(now.getTime() + IN_FLIGHT_LEASE_MS),
    },
  });
  if (claimed.count === 0) return { outcome: "skipped", reason: "concurrent_attempt" };
  const attempts = invoice.fneAttempts + 1;

  const fail = async (kind: "transient" | "rejected", message: string) => {
    const plan = planFneFailure({ attempts, kind, message, now });
    await tenantDb.invoice.updateMany({
      where: { id: invoice.id, fneStatus: { in: UNCERTIFIED } },
      data: plan,
    });
    await tenantDb.domainEvent.create({
      data: {
        organizationId,
        type: "invoice.fne_failed",
        payload: { invoiceId: invoice.id, number: invoice.number, attempts, kind, message },
      },
    });
    return { outcome: "failed", kind, message } as const;
  };

  let payload: FneInvoicePayload;
  try {
    payload = buildFnePayload({
      invoice: { ...invoice, number: invoice.number, type: invoice.type },
      lines,
      organization: {
        ...org,
        establishmentId: config.establishmentId,
        pointOfSale: config.pointOfSale,
      },
      customer,
      paymentMethod: allocation?.payment?.method ?? null,
      originalInvoice: original,
    });
  } catch (error) {
    // Données incomplètes (NCC absent…) : correction humaine, pas de reprise automatique.
    return fail("rejected", isDomainError(error) ? error.message : String(error));
  }

  let result: Awaited<ReturnType<FneCertifier["certify"]>>;
  try {
    const provider = await input.resolveProvider(organizationId);
    result = await provider.certify(payload);
  } catch (error) {
    const { kind, message } = classifyFneError(error);
    return fail(kind, message);
  }

  const written = await tenantDb.invoice.updateMany({
    where: { id: invoice.id, fneStatus: { in: UNCERTIFIED } },
    data: {
      fneStatus: "CERTIFIED",
      fneNumber: result.fneNumber,
      fneQrCode: result.qrCode,
      fneCertifiedAt: result.signedAt,
      fneRaw: (result.raw ?? {}) as Prisma.InputJsonValue,
      fneError: null,
      fneErrorKind: null,
      fneNextRetryAt: null,
    },
  });
  if (written.count === 0) return { outcome: "skipped", reason: "certified_meanwhile" };
  await tenantDb.domainEvent.create({
    data: {
      organizationId,
      type: "invoice.fne_certified",
      payload: {
        invoiceId: invoice.id,
        number: invoice.number,
        fneNumber: result.fneNumber,
        source: "api",
      },
    },
  });
  await writeAuditLog({
    organizationId,
    siteId: invoice.siteId,
    action: "invoice.fne_certified",
    entity: "Invoice",
    entityId: invoice.id,
    before: { fneStatus: invoice.fneStatus },
    after: { fneStatus: "CERTIFIED", fneNumber: result.fneNumber, attempts },
  });
  return { outcome: "certified", fneNumber: result.fneNumber };
}

/** `fne.retry` : factures dont la prochaine tentative est échue (règle `isFneRetryDue`). */
export async function dueFneInvoiceIds(organizationId: string, now: Date, limit = 100) {
  const rows = await db.forTenant({ organizationId }).invoice.findMany({
    where: {
      status: { not: "DRAFT" },
      fneStatus: { in: UNCERTIFIED },
      fneNextRetryAt: { lte: now },
    },
    select: { id: true, status: true, fneStatus: true, fneErrorKind: true, fneNextRetryAt: true },
    orderBy: { fneNextRetryAt: "asc" },
    take: limit,
  });
  return rows.filter((r) => isFneRetryDue(r, now)).map((r) => r.id);
}

/**
 * RG-M08-16 — facture émise non certifiée depuis plus d'1 h → notification ACCOUNTANT et OWNER,
 * une seule fois par facture et par destinataire. Renvoie le nombre de notifications créées.
 */
export async function alertUncertifiedFne(organizationId: string, now: Date): Promise<number> {
  const tenantDb = db.forTenant({ organizationId });
  const invoices = await tenantDb.invoice.findMany({
    where: {
      status: { not: "DRAFT" },
      fneStatus: { in: UNCERTIFIED },
      issuedAt: { lt: new Date(now.getTime() - 60 * 60_000) },
    },
    select: {
      id: true,
      number: true,
      status: true,
      fneStatus: true,
      issuedAt: true,
      fneError: true,
    },
    orderBy: { issuedAt: "asc" },
    take: 200,
  });
  const due = invoices.filter((i) => isFneAlertDue(i, now));
  if (due.length === 0) return 0;
  const recipients = await tenantDb.membership.findMany({
    where: { isActive: true, role: { in: ["OWNER", "ACCOUNTANT"] } },
    select: { id: true },
  });
  let created = 0;
  for (const invoice of due) {
    const dedupeKey = `fne.uncertified:${invoice.id}`;
    for (const { id: membershipId } of recipients) {
      const existing = await tenantDb.notification.findFirst({
        where: { membershipId, dedupeKey },
      });
      if (existing) continue;
      await tenantDb.notification.create({
        data: {
          organizationId,
          membershipId,
          type: "invoice.fne_uncertified",
          severity: invoice.fneStatus === "FAILED" ? "critical" : "warning",
          title: `Facture ${invoice.number ?? "émise"} non certifiée FNE`,
          body:
            invoice.fneError ??
            "Émise depuis plus d'une heure sans certification FNE : saisissez le numéro FNE ou réessayez.",
          link: `/factures/${invoice.id}`,
          dedupeKey,
        },
      });
      created++;
    }
  }
  return created;
}
