-- M05 — Devis et approbation (§14 du PRD, docs/02-modele-donnees.md).
-- LaborOperation.updatedAt reçoit un défaut SQL pour les lignes existantes (comme M04).

-- CreateEnum
CREATE TYPE "QuoteOrigin" AS ENUM ('REPAIR_ORDER', 'INSPECTION', 'STANDALONE', 'APPOINTMENT', 'INSURANCE');

-- DropIndex
DROP INDEX "LaborOperation_organizationId_code_idx";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "requiresPurchaseOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LaborOperation" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerDescription" TEXT,
ADD COLUMN     "defaultParts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "isServiceOperation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vehicleOverrides" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "acceptedTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "customerPoNumber" TEXT,
ADD COLUMN     "decisionCounterpart" TEXT,
ADD COLUMN     "decisionHash" TEXT,
ADD COLUMN     "decisionIp" TEXT,
ADD COLUMN     "decisionMessageId" TEXT,
ADD COLUMN     "decisionUserAgent" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "depositAmount" INTEGER,
ADD COLUMN     "depositInvoiceId" TEXT,
ADD COLUMN     "discountApprovalStatus" TEXT,
ADD COLUMN     "discountApprovedById" TEXT,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "globalDiscountAmount" INTEGER,
ADD COLUMN     "globalDiscountRate" INTEGER,
ADD COLUMN     "inspectionId" TEXT,
ADD COLUMN     "insuranceClaimId" TEXT,
ADD COLUMN     "origin" "QuoteOrigin" NOT NULL DEFAULT 'STANDALONE',
ADD COLUMN     "recipientContactId" TEXT,
ADD COLUMN     "recordedById" TEXT,
ADD COLUMN     "sentTo" TEXT,
ADD COLUMN     "sentVia" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersedesId" TEXT;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "costPrice" INTEGER,
ADD COLUMN     "customerExplanation" TEXT,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "groupKey" TEXT,
ADD COLUMN     "groupLabel" TEXT,
ADD COLUMN     "inspectionItemId" TEXT,
ADD COLUMN     "isCustomerSupplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lineSubtotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lineTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lineVat" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoAttachmentIds" TEXT[],
ADD COLUMN     "requiresGroupKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LaborOperation_organizationId_code_key" ON "LaborOperation"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Quote_organizationId_status_sentAt_idx" ON "Quote"("organizationId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "Quote_organizationId_repairOrderId_idx" ON "Quote"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "Quote_organizationId_customerId_idx" ON "Quote"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
