-- RG-M03-10 : compteur d'absences sur 12 mois glissants, mis en cache sur la fiche client.
ALTER TABLE "Customer" ADD COLUMN "noShowCount12m" INTEGER NOT NULL DEFAULT 0;
