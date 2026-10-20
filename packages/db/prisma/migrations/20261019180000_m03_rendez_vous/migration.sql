-- M03 — Rendez-vous et planning (docs/modules/M03-rendez-vous-planning.md §14)

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "complaint" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedVia" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "laborOperationIds" TEXT[],
ADD COLUMN     "mechanicId" TEXT,
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "outsideHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overbooked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Bay" ADD COLUMN     "color" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ResourceBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "bayId" TEXT,
    "membershipId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceBlock_organizationId_siteId_startsAt_idx" ON "ResourceBlock"("organizationId", "siteId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_publicToken_key" ON "Appointment"("publicToken");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_status_startsAt_idx" ON "Appointment"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_groupId_idx" ON "Appointment"("organizationId", "groupId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RG-M03-02 : deux RDV actifs ne peuvent se chevaucher sur un même pont (sauf surréservation
-- volontaire). Colonnes TIMESTAMP(3) sans fuseau (stockage UTC) : tsrange, bornes [début, fin)
-- pour autoriser le bord à bord (09:00-10:30 puis 10:30-12:00).
ALTER TABLE "Appointment" ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("bayId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("bayId" IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW') AND NOT overbooked);

ALTER TABLE "Appointment" ADD CONSTRAINT appointment_ends_after_starts CHECK ("endsAt" > "startsAt");
ALTER TABLE "ResourceBlock" ADD CONSTRAINT resource_block_ends_after_starts CHECK ("endsAt" > "startsAt");

-- Row Level Security (01 §3), comme les autres tables métier.
ALTER TABLE "ResourceBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResourceBlock" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ResourceBlock"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "ResourceBlock" TO atelieros_app;
