-- M05 §14 — Devis et approbation client (étape 3.3).
-- Aucune nouvelle table : les politiques RLS existantes de Quote/QuoteLine/LaborOperation/Customer
-- couvrent les colonnes ajoutées.

-- CreateEnum
CREATE TYPE "QuoteOrigin" AS ENUM ('REPAIR_ORDER', 'INSPECTION', 'STANDALONE', 'APPOINTMENT', 'INSURANCE');

-- AlterTable Quote
ALTER TABLE "Quote"
  ADD COLUMN "origin" "QuoteOrigin" NOT NULL DEFAULT 'STANDALONE',
  ADD COLUMN "inspectionId" TEXT,
  ADD COLUMN "insuranceClaimId" TEXT,
  ADD COLUMN "supersedesId" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "globalDiscountRate" INTEGER,
  ADD COLUMN "globalDiscountAmount" INTEGER,
  ADD COLUMN "discountReason" TEXT,
  ADD COLUMN "discountApprovalStatus" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountApprovedById" TEXT,
  ADD COLUMN "sentVia" TEXT,
  ADD COLUMN "sentTo" TEXT,
  ADD COLUMN "recipientContactId" TEXT,
  ADD COLUMN "decisionHash" TEXT,
  ADD COLUMN "decisionIp" TEXT,
  ADD COLUMN "decisionUserAgent" TEXT,
  ADD COLUMN "decisionMessageId" TEXT,
  ADD COLUMN "recordedById" TEXT,
  ADD COLUMN "decisionCounterpart" TEXT,
  ADD COLUMN "acceptedTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositAmount" INTEGER,
  ADD COLUMN "depositInvoiceId" TEXT,
  ADD COLUMN "customerPoNumber" TEXT,
  ADD COLUMN "convertedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable QuoteLine
ALTER TABLE "QuoteLine"
  ADD COLUMN "groupKey" TEXT,
  ADD COLUMN "groupLabel" TEXT,
  ADD COLUMN "requiresGroupKey" TEXT,
  ADD COLUMN "customerExplanation" TEXT,
  ADD COLUMN "inspectionItemId" TEXT,
  ADD COLUMN "photoAttachmentIds" TEXT[],
  ADD COLUMN "costPrice" INTEGER,
  ADD COLUMN "isCustomerSupplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "declineReason" TEXT,
  ADD COLUMN "lineSubtotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lineVat" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lineTotal" INTEGER NOT NULL DEFAULT 0;

-- AlterTable LaborOperation
ALTER TABLE "LaborOperation"
  ADD COLUMN "customerDescription" TEXT,
  ADD COLUMN "defaultParts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "vehicleOverrides" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "isServiceOperation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN "requiresPurchaseOrder" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Quote_organizationId_status_sentAt_idx" ON "Quote"("organizationId", "status", "sentAt");
CREATE INDEX "Quote_organizationId_repairOrderId_idx" ON "Quote"("organizationId", "repairOrderId");
CREATE INDEX "Quote_organizationId_customerId_idx" ON "Quote"("organizationId", "customerId");
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
CREATE UNIQUE INDEX "LaborOperation_organizationId_code_key" ON "LaborOperation"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
