-- Recherche globale tolérante aux fautes (RG-M02-19) : trigrammes + suppression des accents.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "PlateType" AS ENUM ('STANDARD', 'TEMPORARY', 'DIPLOMATIC', 'GOVERNMENT', 'FOREIGN', 'NONE', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleUsage" AS ENUM ('PRIVATE', 'TAXI', 'TRANSPORT', 'UTILITY', 'RENTAL', 'OTHER');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "consentSource" TEXT,
ADD COLUMN     "consentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone2" TEXT;

-- AlterTable
ALTER TABLE "MileageReading" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isOutlier" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "makeId" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "nextServiceTrigger" TEXT,
ADD COLUMN     "odometerInMiles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "odometerOffset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plateCompact" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "plateType" "PlateType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "usage" "VehicleUsage" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "idA" TEXT NOT NULL,
    "idB" TEXT NOT NULL,
    "dismissedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VehicleMake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "makeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "defaultFuel" "FuelType",
    "serviceIntervalKm" INTEGER,
    "serviceIntervalMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerNote_organizationId_customerId_idx" ON "CustomerNote"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateDismissal_organizationId_entity_idA_idB_key" ON "DuplicateDismissal"("organizationId", "entity", "idA", "idB");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMake_organizationId_name_key" ON "VehicleMake"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_makeId_organizationId_name_key" ON "VehicleModel"("makeId", "organizationId", "name");

-- CreateIndex
CREATE INDEX "Customer_organizationId_phone2_idx" ON "Customer"("organizationId", "phone2");

-- CreateIndex
CREATE INDEX "Customer_organizationId_email_idx" ON "Customer"("organizationId", "email");

-- CreateIndex
CREATE INDEX "MileageReading_vehicleId_readAt_idx" ON "MileageReading"("vehicleId", "readAt");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_plateCompact_idx" ON "Vehicle"("organizationId", "plateCompact");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_vin_idx" ON "Vehicle"("organizationId", "vin");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSegment" ADD CONSTRAINT "CustomerSegment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMake" ADD CONSTRAINT "VehicleMake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "VehicleMake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill plateCompact depuis "plate" pour les véhicules déjà en base (RG-M02-05 : majuscules,
-- caractères hors [A-Z0-9] retirés — même règle que packages/core/src/plate.ts#normalizePlate).
UPDATE "Vehicle" SET "plateCompact" = UPPER(REGEXP_REPLACE("plate", '[^A-Za-z0-9]', '', 'g'));

-- Unicité partielle de plaque (RG-M02-05) : parmi les véhicules non supprimés, hors "SANS PLAQUE".
CREATE UNIQUE INDEX "vehicle_plate_unique" ON "Vehicle" ("organizationId", "plateCompact")
  WHERE "deletedAt" IS NULL AND "plateType" <> 'NONE';

-- Index trigrammes (RG-M02-19, Définition de terminé §13) pour la recherche globale tolérante.
CREATE INDEX "customer_display_name_trgm" ON "Customer" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX "vehicle_plate_compact_trgm" ON "Vehicle" USING gin ("plateCompact" gin_trgm_ops);
CREATE INDEX "vehicle_vin_trgm" ON "Vehicle" USING gin ("vin" gin_trgm_ops);
CREATE INDEX "customer_contact_name_trgm" ON "CustomerContact" USING gin ("name" gin_trgm_ops);

-- Row Level Security (cf. 20261018233736_enable_rls) pour les nouvelles tables tenant-scopées.
ALTER TABLE "CustomerNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerNote"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DuplicateDismissal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DuplicateDismissal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DuplicateDismissal"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CustomerSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerSegment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerSegment"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

-- VehicleMake/VehicleModel : organizationId NULL = catalogue global (plateforme), visible de
-- toutes les organisations ; seules les lignes propres à l'organisation sont modifiables par elle.
ALTER TABLE "VehicleMake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VehicleMake" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VehicleMake"
  USING ("organizationId" IS NULL OR "organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "VehicleModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VehicleModel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VehicleModel"
  USING ("organizationId" IS NULL OR "organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
