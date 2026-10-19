-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneInvalidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone2" TEXT;

-- CreateEnum
CREATE TYPE "VehicleUsage" AS ENUM ('PRIVATE', 'TAXI', 'TRANSPORT', 'UTILITY', 'RENTAL', 'OTHER');

-- AlterTable
ALTER TABLE "MileageReading" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isOutlier" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "dataQualityFlags" TEXT[],
ADD COLUMN     "inspectionExpiryEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextServiceTrigger" TEXT,
ADD COLUMN     "odometerOffset" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceDueBasis" TEXT,
ADD COLUMN     "usage" "VehicleUsage" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "MileageReading_vehicleId_readAt_idx" ON "MileageReading"("vehicleId", "readAt");

-- CreateIndex
CREATE INDEX "Customer_organizationId_phone2_idx" ON "Customer"("organizationId", "phone2");

-- CreateIndex
CREATE INDEX "Customer_organizationId_email_idx" ON "Customer"("organizationId", "email");
