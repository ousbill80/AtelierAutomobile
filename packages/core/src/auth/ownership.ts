import type { Role } from "./permissions";

// RG-M01-11 — une organisation garde toujours ≥ 1 Membership OWNER active : interdit de
// désactiver, rétrograder ou supprimer le dernier.

export interface MembershipRoleState {
  id: string;
  role: Role;
  isActive: boolean;
}

/**
 * Vrai si retirer/rétrograder/désactiver `targetMembershipId` ne laisserait plus aucun
 * OWNER actif dans l'organisation. Ignore les membres qui ne sont pas eux-mêmes un OWNER
 * actif (les retirer ne change rien au nombre d'OWNER restants).
 */
export function wouldRemoveLastOwner(
  memberships: readonly MembershipRoleState[],
  targetMembershipId: string,
): boolean {
  const target = memberships.find((m) => m.id === targetMembershipId);
  if (!target || target.role !== "OWNER" || !target.isActive) {
    return false;
  }

  const remainingActiveOwners = memberships.filter(
    (m) => m.id !== targetMembershipId && m.role === "OWNER" && m.isActive,
  ).length;

  return remainingActiveOwners === 0;
}
