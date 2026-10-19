/*
  Warnings:

  - Added the required column `updatedAt` to the `MessageTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('REMINDER', 'TRANSACTIONAL', 'CONVERSATION', 'DIGEST', 'SYSTEM');

-- Les index trigramme (customer_display_name_trgm, customer_contact_name_trgm,
-- vehicle_plate_compact_trgm, vehicle_vin_trgm, migration 20261019012546) ne sont pas
-- déclarés dans schema.prisma (SQL brut, RG-M02-19) : `prisma migrate dev` les voit comme
-- disparus et génère des DROP INDEX par erreur. Volontairement omis ici (cf. Étape 1.1).

-- AlterTable
ALTER TABLE "ChannelConfig" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "messagingTier" TEXT,
ADD COLUMN     "webhookVerifyToken" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "candidateCustomerIds" TEXT[],
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "whatsappWindowExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "emailInvalidAt" TIMESTAMP(3),
ADD COLUMN     "hasWhatsappCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "intentConfidence" DOUBLE PRECISION,
ADD COLUMN     "kind" "MessageKind" NOT NULL DEFAULT 'REMINDER',
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "whatsappTemplateName" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isTransactional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" "ReminderType",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "whatsappCategory" TEXT,
ADD COLUMN     "whatsappParamMap" JSONB,
ADD COLUMN     "whatsappRejectedReason" TEXT,
ADD COLUMN     "whatsappVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OptOut" ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateKey" TEXT,
    "createdById" TEXT,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "providerCode" TEXT,
    "providerRaw" JSONB,

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_organizationId_shortcut_key" ON "QuickReply"("organizationId", "shortcut");

-- CreateIndex
CREATE INDEX "MessageAttempt_organizationId_messageId_idx" ON "MessageAttempt"("organizationId", "messageId");

-- CreateIndex
CREATE INDEX "Message_organizationId_customerId_createdAt_idx" ON "Message"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_status_createdAt_idx" ON "Message"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
