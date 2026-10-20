-- M16 §14 — Assurances et sinistres (étape 5.3).
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClaimStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "ClaimStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "accidentPlace" TEXT,
ADD COLUMN     "approvalRef" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "circumstances" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "depreciationAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estimateSentAt" TIMESTAMP(3),
ADD COLUMN     "expertEmail" TEXT,
ADD COLUMN     "expertFirm" TEXT,
ADD COLUMN     "expertPhone" TEXT,
ADD COLUMN     "expertVisitedAt" TIMESTAMP(3),
ADD COLUMN     "gapAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gapHandling" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "vatPaidBy" "Payer" NOT NULL DEFAULT 'INSURANCE';

-- AlterTable
ALTER TABLE "InsuranceCompany" ADD COLUMN     "accountingEmail" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "claimsContactName" TEXT,
ADD COLUMN     "claimsEmail" TEXT,
ADD COLUMN     "claimsPhone" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "followUpConfig" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "laborRate" INTEGER,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ncc" TEXT,
ADD COLUMN     "partsDiscountRate" INTEGER,
ADD COLUMN     "rccm" TEXT,
ADD COLUMN     "requiredDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Dossiers existants (créés avant M16) : numéro provisoire unique, puis colonne obligatoire.
UPDATE "InsuranceClaim" SET "number" = 'SIN-' || "id" WHERE "number" IS NULL;
ALTER TABLE "InsuranceClaim" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "InsuranceCompany" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "InsuranceCompany" ALTER COLUMN "requiredDocuments" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ClaimActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "messageId" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PLANNED',
    "channel" "Channel",
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimActivity_organizationId_claimId_createdAt_idx" ON "ClaimActivity"("organizationId", "claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimFollowUp_organizationId_status_scheduledFor_idx" ON "ClaimFollowUp"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimFollowUp_organizationId_dedupeKey_key" ON "ClaimFollowUp"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "InsuranceClaim_organizationId_insuranceCompanyId_idx" ON "InsuranceClaim"("organizationId", "insuranceCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_organizationId_number_key" ON "InsuranceClaim"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceCompany_customerId_key" ON "InsuranceCompany"("customerId");

-- AddForeignKey
ALTER TABLE "InsuranceCompany" ADD CONSTRAINT "InsuranceCompany_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimActivity" ADD CONSTRAINT "ClaimActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimActivity" ADD CONSTRAINT "ClaimActivity_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUp" ADD CONSTRAINT "ClaimFollowUp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUp" ADD CONSTRAINT "ClaimFollowUp_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (01-architecture-technique.md §3) sur les nouvelles tables.
ALTER TABLE "ClaimActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClaimActivity"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ClaimFollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimFollowUp" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClaimFollowUp"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
