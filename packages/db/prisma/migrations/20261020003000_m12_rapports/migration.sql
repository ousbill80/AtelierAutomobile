-- M12 partie 2 (étape 6.1) — rapports complets. Pas de nouvelle table : les indicateurs sont
-- agrégés en SQL à la demande (GROUP BY sur des requêtes indexées) ; ces index couvrent les
-- filtres de période des rapports et du tableau de bord.

CREATE INDEX "Invoice_organizationId_issuedAt_idx" ON "Invoice"("organizationId", "issuedAt");
CREATE INDEX "Payment_organizationId_receivedAt_idx" ON "Payment"("organizationId", "receivedAt");
CREATE INDEX "Refund_organizationId_createdAt_idx" ON "Refund"("organizationId", "createdAt");
CREATE INDEX "RepairOrder_organizationId_createdAt_idx" ON "RepairOrder"("organizationId", "createdAt");
CREATE INDEX "RepairOrder_organizationId_deliveredAt_idx" ON "RepairOrder"("organizationId", "deliveredAt");
CREATE INDEX "Quote_organizationId_decidedAt_idx" ON "Quote"("organizationId", "decidedAt");
CREATE INDEX "TimeEntry_organizationId_startedAt_idx" ON "TimeEntry"("organizationId", "startedAt");
CREATE INDEX "Reminder_organizationId_sentAt_idx" ON "Reminder"("organizationId", "sentAt");
