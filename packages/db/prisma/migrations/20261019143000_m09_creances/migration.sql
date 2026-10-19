-- Étape 2.3 — M09 Créances et recouvrement (§14).
-- Les index trigramme (SQL brut, RG-M02-19) sont volontairement omis (cf. migration M10).
-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('REACHED', 'NO_ANSWER', 'WRONG_NUMBER', 'CALLBACK');

-- AlterEnum
ALTER TYPE "PromiseStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "CollectionCase" ADD COLUMN     "anchorDate" DATE,
ADD COLUMN     "brokenPromiseCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disputeOpenedAt" TIMESTAMP(3),
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputedAmount" INTEGER,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "formalNoticeAt" TIMESTAMP(3),
ADD COLUMN     "formalNoticeDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "formalNoticeMethod" TEXT,
ADD COLUMN     "lastContactAt" TIMESTAMP(3),
ADD COLUMN     "maxDaysOverdue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overdueDue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previousStatus" "CollectionStatus",
ADD COLUMN     "unreachableCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CollectionNote" ADD COLUMN     "callOutcome" "CallOutcome",
ADD COLUMN     "callbackAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "creditHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditHoldReason" TEXT,
ADD COLUMN     "riskComponents" JSONB;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "collectionCaseId" TEXT,
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "writeOffReason" TEXT,
ADD COLUMN     "writtenOffAmount" INTEGER,
ADD COLUMN     "writtenOffAt" TIMESTAMP(3),
ADD COLUMN     "writtenOffById" TEXT;

-- AlterTable
ALTER TABLE "PaymentPromise" ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "evaluatedAt" TIMESTAMP(3),
ADD COLUMN     "paidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderId" TEXT;

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "cashOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CreditOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "CreditOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttribution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentAllocationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reminderId" TEXT,
    "collectionNoteId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivableSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "date" DATE NOT NULL,
    "notDue" INTEGER NOT NULL,
    "b0_30" INTEGER NOT NULL,
    "b31_60" INTEGER NOT NULL,
    "b61_90" INTEGER NOT NULL,
    "b90p" INTEGER NOT NULL,

    CONSTRAINT "ReceivableSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditOverride_organizationId_customerId_idx" ON "CreditOverride"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttribution_paymentAllocationId_key" ON "PaymentAttribution"("paymentAllocationId");

-- CreateIndex
CREATE INDEX "PaymentAttribution_organizationId_createdAt_idx" ON "PaymentAttribution"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivableSnapshot_organizationId_siteId_date_key" ON "ReceivableSnapshot"("organizationId", "siteId", "date");

-- CreateIndex
CREATE INDEX "CollectionCase_organizationId_customerId_idx" ON "CollectionCase"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_customerId_status_idx" ON "Invoice"("organizationId", "customerId", "status");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_collectionCaseId_fkey" FOREIGN KEY ("collectionCaseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditOverride" ADD CONSTRAINT "CreditOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditOverride" ADD CONSTRAINT "CreditOverride_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttribution" ADD CONSTRAINT "PaymentAttribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttribution" ADD CONSTRAINT "PaymentAttribution_paymentAllocationId_fkey" FOREIGN KEY ("paymentAllocationId") REFERENCES "PaymentAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivableSnapshot" ADD CONSTRAINT "ReceivableSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS (multi-locataire)
ALTER TABLE "CreditOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditOverride"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PaymentAttribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttribution" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentAttribution"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "ReceivableSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceivableSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReceivableSnapshot"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
