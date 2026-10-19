-- M12 §14 — alertes : sévérité et clé de dédoublonnage des notifications (RG-M12-27/28)
ALTER TABLE "Notification" ADD COLUMN "severity" TEXT;
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_organizationId_membershipId_dedupeKey_key" ON "Notification"("organizationId", "membershipId", "dedupeKey");
