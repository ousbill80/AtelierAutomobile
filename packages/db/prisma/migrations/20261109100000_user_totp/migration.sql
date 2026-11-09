-- Application d'authentification (TOTP) pour la vérification « nouvel appareil » (RG-M01-07).
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpLastUsedStep" INTEGER;
