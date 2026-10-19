-- M10 §14 — champs de qualité de données nécessaires au moteur de relances
-- RG-M10-32 : plus aucun envoi vers un numéro en échec définitif tant que la fiche n'est pas corrigée.
ALTER TABLE "Customer" ADD COLUMN     "phoneInvalidAt" TIMESTAMP(3);

-- RG-M10-30 : date d'expiration VT estimée (pas de VT connue) ; base de calcul de la prochaine révision ;
-- indicateurs de qualité des données du véhicule (plaque dupliquée, date de VT suspecte, etc.).
ALTER TABLE "Vehicle" ADD COLUMN     "serviceDueBasis" TEXT,
ADD COLUMN     "inspectionExpiryEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataQualityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];
