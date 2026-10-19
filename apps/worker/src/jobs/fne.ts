// M08 §9 — jobs FNE. `fne.certify` : une tentative pour la facture émise (idempotente, voir
// `certifyInvoiceFne`). `fne.retry` : parcourt les organisations en mode `api` et re-soumet les
// factures dont la reprise est échue (10 min, 30 min, 1 h, 2 h, puis 6 h), puis signale à
// l'ACCOUNTANT et à l'OWNER celles qui restent non certifiées depuis plus d'1 h (RG-M08-16).
import { systemClock, type Clock } from "@atelieros/core";
import {
  adminDb,
  alertUncertifiedFne,
  certifyInvoiceFne,
  dueFneInvoiceIds,
  loadFneConfigRecord,
  type ResolveFneCertifier,
} from "@atelieros/db";
import { loadEncryptionKey, resolveFneProvider } from "@atelieros/integrations";
import { logger } from "../logger";
import type { FneCertifyJobData } from "../queues/fne";

/** Fournisseur FNE de l'organisation (identifiants déchiffrés à la volée, jamais journalisés). */
export const resolveFneFromConfig: ResolveFneCertifier = (organizationId) =>
  resolveFneProvider(organizationId, {
    store: { get: loadFneConfigRecord },
    encryptionKey: () => loadEncryptionKey(),
    allowSimulator: process.env.APP_ENV !== "production",
  });

export async function processFneCertifyJob(
  data: FneCertifyJobData,
  clock: Clock = systemClock,
  resolveProvider: ResolveFneCertifier = resolveFneFromConfig,
) {
  const result = await certifyInvoiceFne({ ...data, now: clock.now(), resolveProvider });
  logger.info(
    { organizationId: data.organizationId, invoiceId: data.invoiceId, outcome: result.outcome },
    "fne.certify",
  );
  return result;
}

/** Reprises d'une organisation ; renvoie le nombre de factures re-soumises. */
export async function retryDueFneInvoices(
  organizationId: string,
  now: Date,
  resolveProvider: ResolveFneCertifier = resolveFneFromConfig,
): Promise<number> {
  const ids = await dueFneInvoiceIds(organizationId, now);
  for (const invoiceId of ids) {
    await certifyInvoiceFne({ organizationId, invoiceId, now, resolveProvider });
  }
  return ids.length;
}

export async function processFneRetryJob(
  clock: Clock = systemClock,
  resolveProvider: ResolveFneCertifier = resolveFneFromConfig,
): Promise<{ retried: number; alerts: number }> {
  const now = clock.now();
  const apiOrgs = await adminDb.fneConfig.findMany({
    where: { mode: "api" },
    select: { organizationId: true },
  });
  let retried = 0;
  for (const { organizationId } of apiOrgs) {
    try {
      retried += await retryDueFneInvoices(organizationId, now, resolveProvider);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "fne.retry : échec sur une organisation, passage à la suivante",
      );
    }
  }
  const late = await adminDb.invoice.findMany({
    where: {
      status: { not: "DRAFT" },
      fneStatus: { in: ["PENDING", "FAILED"] },
      issuedAt: { lt: new Date(now.getTime() - 60 * 60_000) },
    },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  let alerts = 0;
  for (const { organizationId } of late) {
    try {
      alerts += await alertUncertifiedFne(organizationId, now);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "fne.retry : échec du signalement, passage à la suivante",
      );
    }
  }
  return { retried, alerts };
}
