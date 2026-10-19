// M07 — contexte partagé des services de stock : paramètres `settings.stock`, numérotation
// des documents par site (BC, INV, TR — A4), notifications internes et événements.
import {
  DEFAULT_NUMBERING_CONFIG,
  renderNumberingPattern,
  stockSettingsFrom,
  type DocumentType,
  type NumberingConfig,
  type StockSettings,
} from "@atelieros/core";
import type { Prisma } from "@prisma/client";
import { adminDb } from "../client";
import { tenantSequenceStore } from "../receivables";
import type { ScopedTenantClient } from "../tenant";

export type Tx = ScopedTenantClient;

export interface StockContext {
  organizationId: string;
  settings: StockSettings;
  timezone: string;
  numbering: Partial<Record<DocumentType, Partial<NumberingConfig>>>;
}

/** Paramètres de l'organisation (hors RLS : `Organization` n'est pas une table locataire). */
export async function loadStockContext(organizationId: string): Promise<StockContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settings: true, timezone: true },
  });
  const raw = (org.settings ?? {}) as Record<string, unknown>;
  const numbering =
    raw.numbering && typeof raw.numbering === "object"
      ? (raw.numbering as StockContext["numbering"])
      : {};
  return {
    organizationId,
    settings: stockSettingsFrom(org.settings),
    timezone: org.timezone,
    numbering,
  };
}

/** Numéro suivant d'un document opérationnel numéroté par site : BC-YOP-2026-00008. */
export async function nextSiteDocumentNumber(
  tx: Tx,
  ctx: StockContext,
  docType: Extract<DocumentType, "BC" | "INV" | "TR">,
  siteId: string,
  now: Date,
): Promise<string> {
  const site = await tx.site.findFirstOrThrow({ where: { id: siteId }, select: { code: true } });
  const config = { ...DEFAULT_NUMBERING_CONFIG[docType], ...ctx.numbering[docType] };
  const year = now.getUTCFullYear();
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: ctx.organizationId,
    siteId: config.perSite ? siteId : null,
    docType,
    year: config.resetYearly ? year : 0,
  });
  return renderNumberingPattern(config, {
    siteCode: site.code,
    year,
    month: now.getUTCMonth() + 1,
    value,
  });
}

export async function emitStockEvent(
  tx: Tx,
  organizationId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.domainEvent.create({
    data: { organizationId, type, payload: payload as Prisma.InputJsonValue },
  });
}

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  severity?: "info" | "warning" | "critical";
  /** Une notification par destinataire et par clé (ex. « stock.negative:prod:site:jour »). */
  dedupeKey?: string;
}

/** Notifie les membres actifs ayant l'un des rôles donnés (ou les membres listés). */
export async function notifyMembers(
  tx: Tx,
  organizationId: string,
  target: { roles?: string[]; membershipIds?: string[] },
  input: NotifyInput,
): Promise<number> {
  const or: Prisma.MembershipWhereInput[] = [];
  if (target.roles?.length) or.push({ role: { in: target.roles as never } });
  if (target.membershipIds?.length) or.push({ id: { in: target.membershipIds } });
  if (or.length === 0) return 0;
  const members = await tx.membership.findMany({
    where: { isActive: true, OR: or },
    select: { id: true },
  });
  if (members.length === 0) return 0;
  const result = await tx.notification.createMany({
    data: members.map((m) => ({
      organizationId,
      membershipId: m.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      severity: input.severity ?? "info",
      dedupeKey: input.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
