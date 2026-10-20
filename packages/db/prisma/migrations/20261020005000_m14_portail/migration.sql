-- M14 §14 — portail client complet (étape 6.3) : journal des accès, sessions OTP, défis OTP,
-- avis client, accès flotte des contacts entreprise, slug d'organisation (M15 §14, nullable
-- tant que M15 n'est pas livré).

-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "portalAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "PortalAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "portalTokenId" TEXT,
    "portalSessionId" TEXT,
    "action" TEXT NOT NULL,
    "ipPrefix" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalOtpChallenge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalAccess_organizationId_createdAt_idx" ON "PortalAccess"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalAccess_portalTokenId_action_createdAt_idx" ON "PortalAccess"("portalTokenId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_organizationId_phone_idx" ON "PortalSession"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "PortalOtpChallenge_organizationId_phone_createdAt_idx" ON "PortalOtpChallenge"("organizationId", "phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFeedback_repairOrderId_key" ON "CustomerFeedback"("repairOrderId");

-- CreateIndex
CREATE INDEX "CustomerFeedback_organizationId_createdAt_idx" ON "CustomerFeedback"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_portalTokenId_fkey" FOREIGN KEY ("portalTokenId") REFERENCES "PortalToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_portalSessionId_fkey" FOREIGN KEY ("portalSessionId") REFERENCES "PortalSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalOtpChallenge" ADD CONSTRAINT "PortalOtpChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Slug des organisations existantes (lien /p/connexion?g={slug}) : nom simplifié + suffixe de l'id.
UPDATE "Organization"
SET "slug" = trim(both '-' from left(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), 40))
  || '-' || right("id", 6)
WHERE "slug" IS NULL;

-- Row Level Security (01 §3) sur les nouvelles tables.
ALTER TABLE "PortalAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalAccess" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PortalAccess"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PortalSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PortalSession"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "PortalOtpChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalOtpChallenge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PortalOtpChallenge"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "CustomerFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerFeedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerFeedback"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
