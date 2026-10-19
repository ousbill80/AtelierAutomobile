import { DomainError } from "../errors";

// RG-M01-10 — site actif au login, et disponibilité de l'option « Tous les sites ».

export interface SiteOption {
  id: string;
  name: string;
}

export interface PickActiveSiteInput {
  /** Sites auxquels l'utilisateur a accès (déjà filtrés par Membership.siteIds). */
  authorizedSites: readonly SiteOption[];
  lastActiveSiteId: string | null;
}

/**
 * RG-M01-10 — dernier site utilisé s'il est toujours autorisé, sinon le premier
 * site autorisé par ordre alphabétique.
 */
export function pickActiveSite(input: PickActiveSiteInput): string {
  if (input.authorizedSites.length === 0) {
    throw new DomainError("site.none_authorized", "Aucun site autorisé pour cet utilisateur.");
  }

  if (input.lastActiveSiteId !== null) {
    const stillAuthorized = input.authorizedSites.some(
      (site) => site.id === input.lastActiveSiteId,
    );
    if (stillAuthorized) {
      return input.lastActiveSiteId;
    }
  }

  const sorted = [...input.authorizedSites].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return sorted[0]!.id;
}

/** RG-M01-10 — « Tous les sites » n'est proposé que si l'utilisateur a accès à ≥ 2 sites. */
export function canUseAllSitesOption(authorizedSiteCount: number): boolean {
  return authorizedSiteCount >= 2;
}
