// M14 §4.1 — point d'entrée unique des procédures publiques du portail : limitation de débit
// par IP (RG-M14-06), résolution du jeton à portée stricte (RG-M14-02), journal PortalAccess,
// messages d'état normalisés (expiré / révoqué / introuvable) lus par les pages.
import { TRPCError } from "@trpc/server";
import { systemClock, type Clock, type PortalAccessAction } from "@atelieros/core";
import { db, resolvePortalToken, type PortalScope, type PortalToken } from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";
import { checkPortalRequest, recordInvalidPortalToken } from "./rateLimit";

let clock: Clock = systemClock;

/** Horloge injectable (tests). */
export function setPortalClock(next: Clock): void {
  clock = next;
}

export function portalNow(): Date {
  return clock.now();
}

/** Préfixes lus par les pages pour afficher le bon état (`message.startsWith(...)`). */
export const LINK_EXPIRED = "LINK_EXPIRED";
export const LINK_REVOKED = "LINK_REVOKED";
export const LINK_NOT_FOUND = "LINK_NOT_FOUND";
export const RATE_LIMITED = "RATE_LIMITED";

/** Motifs de révocation automatique (RG-M14-04) montrés au client. */
export const REVOKE_REASONS = {
  invoiceVoided: "invoice_voided",
  customerDeleted: "customer_deleted",
} as const;

export function linkError(
  status: "EXPIRED" | "REVOKED" | "NOT_FOUND",
  reason?: string | null,
): never {
  if (status === "EXPIRED") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${LINK_EXPIRED} : ce lien a expiré. Vous pouvez recevoir un nouveau lien sur le numéro enregistré au garage.`,
    });
  }
  if (status === "REVOKED" && reason === REVOKE_REASONS.invoiceVoided) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${LINK_REVOKED} : cette facture a été annulée. Contactez le garage.`,
    });
  }
  if (status === "REVOKED") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${LINK_REVOKED} : ce lien n'est plus valable. Contactez le garage.`,
    });
  }
  throw new TRPCError({
    code: "NOT_FOUND",
    message: `${LINK_NOT_FOUND} : Lien expiré ou invalide.`,
  });
}

export interface PortalRequestCtx {
  ip: string;
  userAgent: string;
}

/** RG-M14-06 : 30 requêtes/min par IP ; IP bloquée 30 min après 5 jetons invalides. */
export async function guardPortalRequest(ctx: PortalRequestCtx, now: Date): Promise<void> {
  const decision = await checkPortalRequest(ctx.ip, now);
  if (!decision.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        decision.reason === "BLOCKED"
          ? `${RATE_LIMITED} : trop de liens invalides depuis cet appareil. Réessayez dans 30 minutes.`
          : `${RATE_LIMITED} : trop de requêtes. Réessayez dans une minute.`,
    });
  }
}

export interface RequirePortalTokenOptions {
  /** Compte une ouverture (page) plutôt qu'un rafraîchissement (statut, temps réel). */
  count?: boolean;
  /** Action journalisée (défaut : « open » si `count`). */
  action?: PortalAccessAction;
  /** Les rafraîchissements fréquents ne consomment pas le quota par IP. */
  skipRateLimit?: boolean;
  /** Horloge du module appelant (devis, facture, OR…) ; défaut : horloge du portail. */
  now?: Date;
}

/**
 * Résout un jeton pour une procédure publique : renvoie la ligne ACTIVE, sinon lève l'erreur
 * d'état. Un jeton d'une autre portée est « introuvable » et compte comme invalide.
 */
export async function requirePortalToken(
  token: string,
  scopes: readonly PortalScope[],
  ctx: PortalRequestCtx,
  options: RequirePortalTokenOptions = {},
): Promise<PortalToken> {
  const now = options.now ?? portalNow();
  if (!options.skipRateLimit) await guardPortalRequest(ctx, now);
  const count = options.count ?? true;
  const action = options.action ?? (count ? "open" : undefined);
  const resolved = await resolvePortalToken(token, scopes, now, {
    count,
    access: action ? { action, ip: ctx.ip, userAgent: ctx.userAgent } : undefined,
  });
  if (resolved.status === "ACTIVE") {
    // M14 §9 : `portal.opened` à la première ouverture (M10 : résultat de la relance, M12).
    if (count && resolved.row.openCount === 1) {
      await emitDomainEvent(
        db.forTenant({ organizationId: resolved.row.organizationId }),
        resolved.row.organizationId,
        "portal.opened",
        {
          scope: resolved.row.scope,
          targetId: resolved.row.targetId,
          customerId: resolved.row.customerId,
          reminderId: resolved.row.reminderId,
        },
      );
    }
    return resolved.row;
  }
  if (resolved.status === "NOT_FOUND") {
    await recordInvalidPortalToken(ctx.ip, now);
    linkError("NOT_FOUND");
  }
  linkError(resolved.status, resolved.row.revokeReason);
}
