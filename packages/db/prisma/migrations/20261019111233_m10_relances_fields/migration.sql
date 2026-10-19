-- Les index trigramme (customer_display_name_trgm, customer_contact_name_trgm,
-- vehicle_plate_compact_trgm, vehicle_vin_trgm, migration 20261019012546) ne sont pas
-- déclarés dans schema.prisma (SQL brut, RG-M02-19) : `prisma migrate dev` les voit comme
-- disparus et génère des DROP INDEX par erreur. Volontairement omis ici (cf. Étape 1.1).

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneInvalidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "dataQualityFlags" TEXT[],
ADD COLUMN     "inspectionExpiryEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceDueBasis" TEXT;
