import { TRPCError } from "@trpc/server";
import { businessDate, isDomainError, systemClock, type Clock } from "@atelieros/core";
import { adminDb, collectionSettingsFrom, type CollectionSettings } from "@atelieros/db";

/** Horloge injectable pour les tests (CLAUDE.md : jamais `new Date()` direct dans la logique). */
let clock: Clock = systemClock;
export function setReceivablesClock(next: Clock): void {
  clock = next;
}
export function receivablesNow(): Date {
  return clock.now();
}

export interface OrgCollectionContext {
  timeZone: string;
  operatingMode: string;
  settings: CollectionSettings;
  now: Date;
  today: Date;
}

export async function loadOrgCollectionContext(
  organizationId: string,
): Promise<OrgCollectionContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, settings: true, operatingMode: true },
  });
  const now = receivablesNow();
  return {
    timeZone: org.timezone,
    operatingMode: org.operatingMode,
    settings: collectionSettingsFrom(org.settings),
    now,
    today: businessDate(now, org.timezone),
  };
}

export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Traduit une `DomainError` du core en erreur tRPC lisible (message français). */
export function rethrowDomain(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

export function notFound(message = "Dossier introuvable."): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}
