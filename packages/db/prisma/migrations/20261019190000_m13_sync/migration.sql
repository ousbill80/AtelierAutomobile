-- M13 partie 2 (étape 6.4) — synchronisation : suivi des sources planifiées et agent local (M13 §14)
-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SyncAgent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAIRING',
    "version" TEXT,
    "hostname" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SyncAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncAgent_tokenHash_key" ON "SyncAgent"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SyncAgent_pairingCode_key" ON "SyncAgent"("pairingCode");

-- CreateIndex
CREATE INDEX "SyncAgent_organizationId_idx" ON "SyncAgent"("organizationId");

-- AddForeignKey
ALTER TABLE "SyncAgent" ADD CONSTRAINT "SyncAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAgent" ADD CONSTRAINT "SyncAgent_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (cf. 20261018233736_enable_rls) : isolation par organisation et droits du rôle applicatif.
ALTER TABLE "SyncAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncAgent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncAgent"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
