// M12 — contexte commun du tableau de bord et des rapports : horloge injectable, organisation,
// paramètres (`settings.reports`, `settings.costs`) et filtre site (RG-M12-02).
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_MECHANIC_HOURLY_COST,
  resolveCustomPeriod,
  resolvePeriod,
  systemClock,
  type Clock,
  type PeriodPreset,
  type ResolvedPeriod,
} from "@atelieros/core";
import { adminDb, type SiteScope } from "@atelieros/db";

export type { SiteScope };

/** Horloge injectable pour les tests (CLAUDE.md : jamais `new Date()` direct dans la logique). */
let clock: Clock = systemClock;
export function setReportsClock(next: Clock): void {
  clock = next;
}
export function reportsNow(): Date {
  return clock.now();
}

/**
 * RG-M12-02 : le filtre site est toujours intersecté avec `Membership.siteIds`. Un membre
 * restreint ne voit jamais « Tous les sites » : son périmètre est la liste de ses sites.
 */
export function resolveSiteScope(
  ctx: { allowedSiteIds: string[] | "ALL" },
  siteId: string | undefined,
): SiteScope {
  if (siteId) {
    if (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(siteId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Vous n'avez pas accès à ce site." });
    }
    return { siteIds: [siteId] };
  }
  return { siteIds: ctx.allowedSiteIds === "ALL" ? null : ctx.allowedSiteIds };
}

export interface OrgReportContext {
  name: string;
  legalName: string | null;
  ncc: string | null;
  timezone: string;
  operatingMode: string;
  attributionWindowDays: number;
  defaultMechanicHourlyCost: number;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

// `Organization` n'est pas un modèle « tenant » : lecture par id de l'organisation active.
export async function loadOrgReportContext(organizationId: string): Promise<OrgReportContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      name: true,
      legalName: true,
      ncc: true,
      timezone: true,
      operatingMode: true,
      settings: true,
    },
  });
  const settings = (org.settings ?? {}) as {
    reports?: { attributionWindowDays?: unknown };
    costs?: { defaultMechanicHourlyCost?: unknown };
  };
  return {
    name: org.name,
    legalName: org.legalName,
    ncc: org.ncc,
    timezone: org.timezone,
    operatingMode: org.operatingMode,
    attributionWindowDays: positiveInt(settings.reports?.attributionWindowDays, 14),
    defaultMechanicHourlyCost: positiveInt(
      settings.costs?.defaultMechanicHourlyCost,
      DEFAULT_MECHANIC_HOURLY_COST,
    ),
  };
}

export type PeriodInput = PeriodPreset | { from: string; to: string };

/** RG-M12-01 : préréglage ou période personnalisée (bornes incluses). */
export function resolvePeriodInput(
  period: PeriodInput,
  now: Date,
  timeZone: string,
): ResolvedPeriod {
  return typeof period === "string"
    ? resolvePeriod(period, now, timeZone)
    : resolveCustomPeriod(period.from, period.to, timeZone);
}
