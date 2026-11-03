-- Relances : canal imposé par l'utilisateur (« Renvoyer par… »), sans repli automatique.
ALTER TABLE "Reminder" ADD COLUMN "channelLocked" BOOLEAN NOT NULL DEFAULT false;
