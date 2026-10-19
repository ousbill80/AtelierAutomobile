-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "phoneInvalidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
-- NB : "nextServiceTrigger", "odometerOffset" et "usage" (+ l'enum "VehicleUsage") sont déjà
-- créés par la migration 20261019020000_clients_vehicules_m02 (fusion de l'Étape 2.1/2.2 avec
-- l'Étape 1.1 sur main) ; seules les colonnes propres à M10 §14 restent à ajouter ici.
ALTER TABLE "Vehicle" ADD COLUMN     "dataQualityFlags" TEXT[],
ADD COLUMN     "inspectionExpiryEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceDueBasis" TEXT;
