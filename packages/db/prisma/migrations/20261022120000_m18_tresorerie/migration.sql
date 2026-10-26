-- M18 (trésorerie) — comptes, grand livre immuable, virements, rapprochements ; versement de
-- caisse vers un compte, dépense hors caisse.

-- CreateEnum
CREATE TYPE "TreasuryAccountType" AS ENUM ('CASH_REGISTER', 'SAFE', 'BANK', 'MOBILE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "TreasuryDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "TreasuryMovementKind" AS ENUM ('PAYMENT', 'PAYMENT_REVERSAL', 'REFUND', 'EXPENSE', 'CASH_DROP', 'CASH_VARIANCE', 'TRANSFER', 'INCOME', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "treasuryAccountId" TEXT;

-- AlterTable
ALTER TABLE "CashDrop" ADD COLUMN     "toAccountId" TEXT;

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "type" "TreasuryAccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "paymentMethods" "PaymentMethod"[],
    "bankName" TEXT,
    "accountRef" TEXT,
    "ledgerAccount" TEXT,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "openingDate" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteId" TEXT,
    "direction" "TreasuryDirection" NOT NULL,
    "kind" "TreasuryMovementKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "reference" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "transferId" TEXT,
    "counterpartAccountId" TEXT,
    "reversalOfId" TEXT,
    "reconciliationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementDate" DATE NOT NULL,
    "statementBalance" INTEGER NOT NULL,
    "computedBalance" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryAccount_organizationId_type_idx" ON "TreasuryAccount"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_organizationId_name_key" ON "TreasuryAccount"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_reversalOfId_key" ON "TreasuryMovement"("reversalOfId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_organizationId_accountId_occurredAt_idx" ON "TreasuryMovement"("organizationId", "accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "TreasuryMovement_organizationId_occurredAt_idx" ON "TreasuryMovement"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_organizationId_accountId_sourceType_source_key" ON "TreasuryMovement"("organizationId", "accountId", "sourceType", "sourceId", "kind");

-- CreateIndex
CREATE INDEX "TreasuryTransfer_organizationId_occurredAt_idx" ON "TreasuryTransfer"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "TreasuryReconciliation_organizationId_accountId_statementDa_idx" ON "TreasuryReconciliation"("organizationId", "accountId", "statementDate");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrop" ADD CONSTRAINT "CashDrop_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransfer" ADD CONSTRAINT "TreasuryTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryReconciliation" ADD CONSTRAINT "TreasuryReconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryReconciliation" ADD CONSTRAINT "TreasuryReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS (cf. 20261018233736_enable_rls) : isolation par organisation des nouvelles tables.
ALTER TABLE "TreasuryAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreasuryAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreasuryAccount"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "TreasuryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreasuryMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreasuryMovement"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "TreasuryTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreasuryTransfer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreasuryTransfer"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "TreasuryReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TreasuryReconciliation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreasuryReconciliation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

