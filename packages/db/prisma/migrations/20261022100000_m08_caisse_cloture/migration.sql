-- M08 §14 (caisse et clôture) — circuit de validation des dépenses (RG-M08-30) et instantané
-- figé de la clôture (Z de caisse, totaux par mode de paiement).

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "closingSummary" JSONB;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "decisionComment" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "Expense_organizationId_status_paidAt_idx" ON "Expense"("organizationId", "status", "paidAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
