-- CreateEnum
CREATE TYPE "ImportPolicy" AS ENUM ('CREATE_ONLY', 'UPSERT', 'UPSERT_OVERWRITE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ImportStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ImportStatus" ADD VALUE 'ROLLED_BACK';

-- AlterTable
ALTER TABLE "ExternalRef" ADD COLUMN     "importJobId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "delimiter" TEXT,
ADD COLUMN     "encoding" TEXT,
ADD COLUMN     "errorReportUrl" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "headerSignature" TEXT,
ADD COLUMN     "mapping" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "policy" "ImportPolicy" NOT NULL DEFAULT 'UPSERT',
ADD COLUMN     "processedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rolledBackAt" TIMESTAMP(3),
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "unchangedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warningCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ImportRowError" ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'ERROR';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "externalNumber" TEXT;
