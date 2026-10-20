// M14 §9 — `portal.tokens_expire` : balayage système (toutes organisations) des jetons du portail
// échus, des défis OTP périmés et du journal PortalAccess de plus de 12 mois. Idempotent.
import { systemClock, type Clock } from "@atelieros/core";
import { expirePortalTokens } from "@atelieros/db";
import { logger } from "../logger";

export async function processPortalTokensExpireJob(
  clock: Clock = systemClock,
  scope: { organizationId?: string } = {},
): Promise<Awaited<ReturnType<typeof expirePortalTokens>>> {
  const result = await expirePortalTokens(clock.now(), scope);
  logger.info(result, "portal.tokens_expire terminé");
  return result;
}
