// M17 RG-M17-20 — purge quotidienne des fils de l'assistant expirés (historique conservé
// 30 jours, `AiAssistantThread.expiresAt`). Les messages suivent par cascade. Tâche
// d'infrastructure, toutes organisations confondues (comme les autres jobs planifiés).
import { adminDb } from "@atelieros/db";
import { logger } from "../logger";

export async function purgeExpiredAssistantThreads(now: Date): Promise<number> {
  const { count } = await adminDb.aiAssistantThread.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return count;
}

export async function processAiAssistantPurgeJob(): Promise<void> {
  const count = await purgeExpiredAssistantThreads(new Date());
  logger.info({ count }, "ai.assistant_purge : fils expirés supprimés");
}
