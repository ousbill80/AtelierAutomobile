-- M07 §14 — Stock, pièces, fournisseurs, achats (étape 5.1).
-- Réservations, inventaires, transferts ; champs de quantités fractionnaires, CMP historisé,
-- surcharges min/max par site ; RLS et index trigram de recherche catalogue (US-M07-01).

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('RESERVED', 'BACKORDERED', 'ISSUED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "crossReferences" TEXT[],
ADD COLUMN     "lastIssuedAt" TIMESTAMP(3),
ADD COLUMN     "packSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "quantityScale" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "receivedCost" INTEGER;

-- AlterTable
ALTER TABLE "StockLevel" ADD COLUMN     "maxStock" INTEGER,
ADD COLUMN     "minStock" INTEGER;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "costAfter" INTEGER,
ADD COLUMN     "countId" TEXT,
ADD COLUMN     "reasonCode" TEXT,
ADD COLUMN     "repairOrderLineId" TEXT,
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "transferId" TEXT;

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "repairOrderLineId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "purchaseOrderId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "varianceValue" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "unitCost" INTEGER NOT NULL,
    "movedAfterCount" BOOLEAN NOT NULL DEFAULT false,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fromSiteId" TEXT NOT NULL,
    "toSiteId" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockReservation_organizationId_siteId_productId_status_idx" ON "StockReservation"("organizationId", "siteId", "productId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_organizationId_repairOrderId_idx" ON "StockReservation"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "StockReservation_productId_idx" ON "StockReservation"("productId");

-- CreateIndex
CREATE INDEX "StockReservation_purchaseOrderId_idx" ON "StockReservation"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "StockCount_organizationId_siteId_status_idx" ON "StockCount"("organizationId", "siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_organizationId_number_key" ON "StockCount"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockCountLine_organizationId_stockCountId_idx" ON "StockCountLine"("organizationId", "stockCountId");

-- CreateIndex
CREATE INDEX "StockCountLine_productId_idx" ON "StockCountLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_stockCountId_productId_key" ON "StockCountLine"("stockCountId", "productId");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_status_idx" ON "StockTransfer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_fromSiteId_idx" ON "StockTransfer"("fromSiteId");

-- CreateIndex
CREATE INDEX "StockTransfer_toSiteId_idx" ON "StockTransfer"("toSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_organizationId_number_key" ON "StockTransfer"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StockTransferLine_organizationId_stockTransferId_idx" ON "StockTransferLine"("organizationId", "stockTransferId");

-- CreateIndex
CREATE INDEX "StockTransferLine_productId_idx" ON "StockTransferLine"("productId");

-- CreateIndex
CREATE INDEX "Product_organizationId_barcode_idx" ON "Product"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "Product_defaultSupplierId_idx" ON "Product"("defaultSupplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");

-- CreateIndex
CREATE INDEX "StockLevel_productId_idx" ON "StockLevel"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_productId_createdAt_idx" ON "StockMovement"("organizationId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_createdAt_idx" ON "StockMovement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_repairOrderId_idx" ON "StockMovement"("repairOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_purchaseOrderId_idx" ON "StockMovement"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_reservationId_idx" ON "StockMovement"("reservationId");

-- CreateIndex
CREATE INDEX "StockMovement_transferId_idx" ON "StockMovement"("transferId");

-- CreateIndex
CREATE INDEX "StockMovement_countId_idx" ON "StockMovement"("countId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "StockReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Les lignes existantes reçoivent un tableau vide (comme `compatibleWith`).
UPDATE "Product" SET "crossReferences" = '{}' WHERE "crossReferences" IS NULL;
-- RG-M07-01 : litre / kg en dixièmes ; les quantités de stock existantes de ces produits
-- (StockLevel, StockMovement, PurchaseOrderLine) passent en unités de base (× 10).
UPDATE "Product" SET "quantityScale" = 10 WHERE "unit" IN ('litre', 'kg');
UPDATE "StockLevel" SET "onHand" = "onHand" * 10, "reserved" = "reserved" * 10
  WHERE "productId" IN (SELECT "id" FROM "Product" WHERE "quantityScale" = 10);
UPDATE "StockMovement" SET "quantity" = "quantity" * 10
  WHERE "productId" IN (SELECT "id" FROM "Product" WHERE "quantityScale" = 10);
UPDATE "PurchaseOrderLine" SET "quantity" = "quantity" * 10, "receivedQty" = "receivedQty" * 10
  WHERE "productId" IN (SELECT "id" FROM "Product" WHERE "quantityScale" = 10);

-- US-M07-01 : recherche floue (ILIKE accéléré par pg_trgm) sur les références et le nom.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "product_name_trgm" ON "Product" USING gin ("name" gin_trgm_ops);
CREATE INDEX "product_sku_trgm" ON "Product" USING gin ("sku" gin_trgm_ops);
CREATE INDEX "product_oem_trgm" ON "Product" USING gin ("oemReference" gin_trgm_ops);

-- Row Level Security (01 §3) sur les nouvelles tables porteuses de organizationId.

ALTER TABLE "StockReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockReservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockReservation"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockCount"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockCountLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransfer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockTransfer"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "StockTransferLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransferLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockTransferLine"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
