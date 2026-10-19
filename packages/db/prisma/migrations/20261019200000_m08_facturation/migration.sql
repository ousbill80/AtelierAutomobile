-- M08 §14 — Facturation, paiements, caisse (étape 4.1). Champs FNE et webhooks inclus pour
-- les étapes 4.2 / 4.3 (une seule migration réservée pour M08, A15).

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "denominations" JSONB,
ADD COLUMN     "lateClose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewComment" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "attachmentId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "costTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fneAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fneErrorKind" TEXT,
ADD COLUMN     "fneNextRetryAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "costAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositInvoiceId" TEXT,
ADD COLUMN     "payer" "Payer" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "repairOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "customerCreditId" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ALTER COLUMN "paymentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CashDrop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "customerCreditId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    "cashSessionId" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCredit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDrop_organizationId_cashSessionId_idx" ON "CashDrop"("organizationId", "cashSessionId");

-- CreateIndex
CREATE INDEX "Refund_organizationId_customerId_idx" ON "Refund"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Refund_organizationId_cashSessionId_idx" ON "Refund"("organizationId", "cashSessionId");

-- CreateIndex
CREATE INDEX "CustomerCredit_organizationId_customerId_idx" ON "CustomerCredit"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "PaymentWebhookLog_provider_providerRef_idx" ON "PaymentWebhookLog"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "CashSession_organizationId_siteId_closedAt_idx" ON "CashSession"("organizationId", "siteId", "closedAt");

-- CreateIndex
CREATE INDEX "InvoiceLine_organizationId_depositInvoiceId_idx" ON "InvoiceLine"("organizationId", "depositInvoiceId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_method_reference_idx" ON "Payment"("organizationId", "method", "reference");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_depositInvoiceId_fkey" FOREIGN KEY ("depositInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_customerCreditId_fkey" FOREIGN KEY ("customerCreditId") REFERENCES "CustomerCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrop" ADD CONSTRAINT "CashDrop_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrop" ADD CONSTRAINT "CashDrop_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrop" ADD CONSTRAINT "CashDrop_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrop" ADD CONSTRAINT "CashDrop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerCreditId_fkey" FOREIGN KEY ("customerCreditId") REFERENCES "CustomerCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookLog" ADD CONSTRAINT "PaymentWebhookLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RG-M08-01 : numérotation fiscale sans trou. Les séquences FAC/AV/REC ont siteId = null (A4)
-- et l'index unique ([organizationId, siteId, docType, year]) ne s'applique pas aux NULL :
-- un index partiel garantit une seule ligne par (organisation, type, année) pour ces séquences,
-- ce qui permet `INSERT … ON CONFLICT DO NOTHING` puis un `UPDATE … lastValue + 1` verrouillant.
CREATE UNIQUE INDEX "DocumentSequence_org_doc_year_null_site_key"
  ON "DocumentSequence"("organizationId", "docType", "year") WHERE "siteId" IS NULL;

-- RLS (01-architecture-technique.md §3) sur les nouvelles tables.
ALTER TABLE "CashDrop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashDrop" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashDrop"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Refund" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Refund"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CustomerCredit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerCredit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerCredit"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

-- Journal des webhooks : écrit par la route publique via la connexion propriétaire ; une ligne
-- sans organisation (organisation inconnue) n'est jamais visible depuis la connexion restreinte.
ALTER TABLE "PaymentWebhookLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentWebhookLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentWebhookLog"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
