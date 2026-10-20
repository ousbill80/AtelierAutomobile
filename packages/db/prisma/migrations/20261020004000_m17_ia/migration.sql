-- M17 — IA et automatisations (§14) : compléments AiInteraction, AiSuggestion,
-- AiAssistantThread/Message, AutomationRule/Run, ajouts Customer, Quote, Reminder.
-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED_ACCEPTED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('AUTO', 'PROPOSE');

-- AlterTable
ALTER TABLE "AiInteraction" ADD COLUMN     "credits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "editDistance" INTEGER,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OK';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "bestChannel" "Channel",
ADD COLUMN     "bestSendHour" INTEGER,
ADD COLUMN     "riskFactors" JSONB,
ADD COLUMN     "riskScoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customerExplanation" JSONB;

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "originalScheduledFor" TIMESTAMP(3),
ADD COLUMN     "timeOptimized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "interactionId" TEXT,
    "feature" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAssistantThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAssistantThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAssistantMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "interactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL,
    "mode" "AutomationMode" NOT NULL DEFAULT 'PROPOSE',
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "siteIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "templateKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_organizationId_targetEntity_targetId_status_idx" ON "AiSuggestion"("organizationId", "targetEntity", "targetId", "status");

-- CreateIndex
CREATE INDEX "AiSuggestion_organizationId_status_expiresAt_idx" ON "AiSuggestion"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiAssistantThread_organizationId_membershipId_updatedAt_idx" ON "AiAssistantThread"("organizationId", "membershipId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiAssistantThread_expiresAt_idx" ON "AiAssistantThread"("expiresAt");

-- CreateIndex
CREATE INDEX "AiAssistantMessage_organizationId_threadId_createdAt_idx" ON "AiAssistantMessage"("organizationId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_isActive_trigger_idx" ON "AutomationRule"("organizationId", "isActive", "trigger");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_status_scheduledFor_idx" ON "AutomationRun"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_ruleId_createdAt_idx" ON "AutomationRun"("organizationId", "ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_ruleId_eventId_key" ON "AutomationRun"("ruleId", "eventId");

-- CreateIndex
CREATE INDEX "AiInteraction_organizationId_feature_createdAt_idx" ON "AiInteraction"("organizationId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_organizationId_createdAt_idx" ON "AiInteraction"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "AiInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantThread" ADD CONSTRAINT "AiAssistantThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantThread" ADD CONSTRAINT "AiAssistantThread_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantMessage" ADD CONSTRAINT "AiAssistantMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantMessage" ADD CONSTRAINT "AiAssistantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiAssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (01-architecture-technique.md §3) sur les nouvelles tables.
ALTER TABLE "AiSuggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSuggestion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiSuggestion"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AiAssistantThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiAssistantThread" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiAssistantThread"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AiAssistantMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiAssistantMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiAssistantMessage"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AutomationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationRule"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AutomationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationRun"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
