-- Les 4 index GIN trigram (recherche globale RG-M02-19) ne sont pas représentables dans
-- schema.prisma (créés par migration.sql brute) : `prisma migrate dev` les voit donc comme
-- une dérive et proposait de les DROP ici. Faux positif déjà connu (cf. réconciliation
-- étape 2.1/2.2) — on ne les touche pas.

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "complaint" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedVia" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "laborOperationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mechanicId" TEXT,
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "outsideHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overbooked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Bay" ADD COLUMN     "color" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ImportJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

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
CREATE INDEX "ResourceBlock_organizationId_bayId_idx" ON "ResourceBlock"("organizationId", "bayId");

-- CreateIndex
CREATE INDEX "ResourceBlock_organizationId_membershipId_idx" ON "ResourceBlock"("organizationId", "membershipId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_status_startsAt_idx" ON "Appointment"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_groupId_idx" ON "Appointment"("organizationId", "groupId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlock" ADD CONSTRAINT "ResourceBlock_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (01-architecture-technique.md §3) : chaque nouvelle table multi-locataire reçoit sa
-- politique, comme les tables précédentes (cf. 20261018233736_enable_rls).
ALTER TABLE "ResourceBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResourceBlock" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ResourceBlock"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

-- RG-M03-02 : deux RDV ne peuvent chevaucher le même pont. Contrainte d'exclusion Postgres
-- (pas représentable dans schema.prisma) plutôt qu'un verrou applicatif — garantie même en
-- cas d'insertions concurrentes (US cas limite "deux réceptionnaires réservent le même créneau").
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- "startsAt"/"endsAt" sont des TIMESTAMP(3) sans fuseau (UTC stocké tel quel, cf. CLAUDE.md
-- « Dates : UTC en base ») : tsrange, pas tstzrange (dont le cast implicite timestamp ->
-- timestamptz n'est pas IMMUTABLE et est refusé dans une expression d'index).
ALTER TABLE "Appointment" ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist ("bayId" WITH =, tsrange("startsAt", "endsAt") WITH &&)
  WHERE ("bayId" IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW') AND NOT overbooked);
