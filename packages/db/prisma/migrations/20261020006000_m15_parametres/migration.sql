-- M15 §14 (étape 6.5) — plans/quotas, export complet, cycle de vie de l'organisation.

-- CreateEnum
CREATE TYPE "OrgLifecycle" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_SCHEDULED', 'PURGED');

-- AlterTable
ALTER TABLE "ChannelConfig" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "InspectionTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable : `slug` est rempli pour les organisations existantes avant d'être rendu obligatoire.
ALTER TABLE "Organization" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletionScheduledFor" TIMESTAMP(3),
ADD COLUMN "lifecycleStatus" "OrgLifecycle" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "planOverrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "settingsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "slug" TEXT,
ADD COLUMN "supportAccessUntil" TIMESTAMP(3);

UPDATE "Organization" SET "slug" = "id" WHERE "slug" IS NULL;
ALTER TABLE "Organization" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "timezone" TEXT;

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "sizeBytes" INTEGER,
    "tableCount" INTEGER,
    "rowCount" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_organizationId_metric_period_key" ON "UsageCounter"("organizationId", "metric", "period");

-- CreateIndex
CREATE INDEX "DataExport_organizationId_createdAt_idx" ON "DataExport"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (01-architecture-technique.md §3) sur les nouvelles tables.
ALTER TABLE "UsageCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UsageCounter"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "DataExport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataExport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataExport"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "UsageCounter" TO atelieros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DataExport" TO atelieros_app;
