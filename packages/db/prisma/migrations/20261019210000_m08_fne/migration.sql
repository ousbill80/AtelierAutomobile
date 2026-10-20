-- Étape 4.2 — FNE (M08 §FNE, M15 RG-M15-18). FneConfig a déjà sa RLS (20261018233736_enable_rls).

-- AlterTable : adaptateur du mode api (dgi_api | fake) et résultat du dernier test.
ALTER TABLE "FneConfig" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastTestOk" BOOLEAN,
ADD COLUMN     "lastTestedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'dgi_api',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex : job fne.retry (RG-M08-15).
CREATE INDEX "Invoice_fneStatus_fneNextRetryAt_idx" ON "Invoice"("fneStatus", "fneNextRetryAt");
