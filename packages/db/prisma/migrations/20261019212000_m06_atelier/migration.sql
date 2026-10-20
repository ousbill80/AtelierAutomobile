-- M06 §14 — atelier, mécaniciens et PWA hors-ligne (étape 5.2).

-- CreateEnum
CREATE TYPE "TimeEntryKind" AS ENUM ('WORK', 'DIAGNOSTIC', 'REWORK');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PartRequestStatus" AS ENUM ('REQUESTED', 'PREPARING', 'ORDERED', 'DELIVERED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "LaborOperation" ADD COLUMN     "requiredSkill" TEXT;

-- AlterTable
ALTER TABLE "RepairOrderLine" ADD COLUMN     "subcontractReturnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "clientOpId" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "kind" "TimeEntryKind" NOT NULL DEFAULT 'WORK',
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pauseReason" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT;

-- CreateTable
CREATE TABLE "QualityCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "checkedById" TEXT NOT NULL,
    "result" "QcResult" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "comment" TEXT,
    "reworkLineIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "repairOrderLineId" TEXT,
    "requestedById" TEXT NOT NULL,
    "productId" TEXT,
    "freeText" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "urgency" "Priority" NOT NULL DEFAULT 'NORMAL',
    "status" "PartRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "handledById" TEXT,
    "purchaseOrderId" TEXT,
    "rejectReason" TEXT,
    "clientOpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "repairOrderLineId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibleToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "clientOpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechSyncOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientOpId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "deviceId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "entityId" TEXT,
    "deviceAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechSyncOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityCheck_organizationId_repairOrderId_idx" ON "QualityCheck"("organizationId", "repairOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PartRequest_clientOpId_key" ON "PartRequest"("clientOpId");

-- CreateIndex
CREATE INDEX "PartRequest_organizationId_siteId_status_idx" ON "PartRequest"("organizationId", "siteId", "status");

-- CreateIndex
CREATE INDEX "PartRequest_organizationId_repairOrderId_idx" ON "PartRequest"("organizationId", "repairOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkNote_clientOpId_key" ON "WorkNote"("clientOpId");

-- CreateIndex
CREATE INDEX "WorkNote_organizationId_repairOrderId_idx" ON "WorkNote"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "TechSyncOperation_organizationId_membershipId_createdAt_idx" ON "TechSyncOperation"("organizationId", "membershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechSyncOperation_organizationId_clientOpId_key" ON "TechSyncOperation"("organizationId", "clientOpId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_organizationId_membershipId_date_key" ON "Attendance"("organizationId", "membershipId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_clientOpId_key" ON "TimeEntry"("clientOpId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_membershipId_startedAt_idx" ON "TimeEntry"("organizationId", "membershipId", "startedAt");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_repairOrderLineId_fkey" FOREIGN KEY ("repairOrderLineId") REFERENCES "RepairOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_repairOrderLineId_fkey" FOREIGN KEY ("repairOrderLineId") REFERENCES "RepairOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNote" ADD CONSTRAINT "WorkNote_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechSyncOperation" ADD CONSTRAINT "TechSyncOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row Level Security (01 §3) sur les nouvelles tables portant organizationId.

ALTER TABLE "QualityCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityCheck" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QualityCheck"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PartRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PartRequest"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "WorkNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkNote"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "TechSyncOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TechSyncOperation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TechSyncOperation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
