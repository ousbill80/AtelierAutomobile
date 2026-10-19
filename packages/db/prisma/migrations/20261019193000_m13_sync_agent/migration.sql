-- M13 partie 2 (étape 6.4) — lots de l'agent local et leur idempotence (RG-M13-28)
-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importJobId" TEXT,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncBatch_organizationId_createdAt_idx" ON "SyncBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncBatch_agentId_idempotencyKey_key" ON "SyncBatch"("agentId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SyncAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (cf. 20261018233736_enable_rls).
ALTER TABLE "SyncBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncBatch"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
