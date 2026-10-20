-- Étape 4.3 — liens de paiement mobile money (M08 RG-M08-23..26) et page facture du portail (M14).
-- PaymentLink, PaymentProviderConfig et PaymentWebhookLog ont déjà leur RLS (init, 4.1).
-- Un seul fournisseur configuré par organisation et par nom (cinetpay | wave | fake).

-- DropIndex
DROP INDEX "PaymentProviderConfig_organizationId_provider_idx";

-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAmount" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "method" "PaymentMethod",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PaymentProviderConfig" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastTestOk" BOOLEAN,
ADD COLUMN     "lastTestedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "PaymentLink_status_expiresAt_idx" ON "PaymentLink"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_provider_providerRef_key" ON "PaymentLink"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderConfig_organizationId_provider_key" ON "PaymentProviderConfig"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

