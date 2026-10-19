-- M04 — Réception et ordres de réparation (§14 du PRD, docs/02-modele-donnees.md).
-- Ajouts hors §14 : RepairOrder.readyAt (ancre VEHICLE_READY de M10), RepairOrder.clientRequestId
-- (idempotence de la réception hors-ligne), RepairOrderLine.cancelReason.

-- CreateEnum
CREATE TYPE "WarrantyDecision" AS ENUM ('COVERED', 'NOT_COVERED', 'PARTIAL');

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "summary" JSONB;

-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN     "shareWithCustomer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InspectionTemplate" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "comebackOfId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deliverySignatureUrl" TEXT,
ADD COLUMN     "invoicedAt" TIMESTAMP(3),
ADD COLUMN     "isComeback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "qcChecklist" JSONB,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "waitingPartsSince" TIMESTAMP(3),
ADD COLUMN     "warrantyDecision" "WarrantyDecision",
ADD COLUMN     "warrantyDecisionReason" TEXT;

-- AlterTable
ALTER TABLE "RepairOrderLine" ADD COLUMN     "approvalSource" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "costPrice" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "inspectionItemId" TEXT,
ADD COLUMN     "isCustomerSupplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subcontractExpectedAt" TIMESTAMP(3),
ADD COLUMN     "subcontractStatus" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "warrantyKm" INTEGER,
ADD COLUMN     "warrantyMonths" INTEGER,
ADD COLUMN     "warrantyUntilDate" DATE,
ADD COLUMN     "warrantyUntilMileage" INTEGER;

-- CreateTable
CREATE TABLE "RepairOrderStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "fromStatus" "RepairOrderStatus",
    "toStatus" "RepairOrderStatus" NOT NULL,
    "transition" TEXT NOT NULL,
    "reason" TEXT,
    "membershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairOrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleRecommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "inspectionItemId" TEXT,
    "quoteLineId" TEXT,
    "label" TEXT NOT NULL,
    "severity" "InspectionResult" NOT NULL,
    "estimatedAmount" INTEGER,
    "remindAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VehicleRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairOrderStatusHistory_repairOrderId_createdAt_idx" ON "RepairOrderStatusHistory"("repairOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairOrderStatusHistory_organizationId_idx" ON "RepairOrderStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "VehicleRecommendation_organizationId_vehicleId_status_idx" ON "VehicleRecommendation"("organizationId", "vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_publicToken_key" ON "RepairOrder"("publicToken");

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_vehicleId_idx" ON "RepairOrder"("organizationId", "vehicleId");

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_siteId_status_idx" ON "RepairOrder"("organizationId", "siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_organizationId_clientRequestId_key" ON "RepairOrder"("organizationId", "clientRequestId");

-- CreateIndex
CREATE INDEX "RepairOrderLine_repairOrderId_idx" ON "RepairOrderLine"("repairOrderId");

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_comebackOfId_fkey" FOREIGN KEY ("comebackOfId") REFERENCES "RepairOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrderStatusHistory" ADD CONSTRAINT "RepairOrderStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrderStatusHistory" ADD CONSTRAINT "RepairOrderStatusHistory_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleRecommendation" ADD CONSTRAINT "VehicleRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row Level Security (01-architecture-technique.md §3) sur les nouvelles tables.
ALTER TABLE "RepairOrderStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepairOrderStatusHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RepairOrderStatusHistory"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "VehicleRecommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VehicleRecommendation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VehicleRecommendation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

