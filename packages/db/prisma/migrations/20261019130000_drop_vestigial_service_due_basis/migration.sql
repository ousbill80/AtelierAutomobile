-- M10 §14 — nettoyage : "serviceDueBasis" faisait double emploi avec "nextServiceTrigger"
-- (déjà introduit par M02 et utilisé par vehicle.ts). On ne garde qu'un seul champ.
ALTER TABLE "Vehicle" DROP COLUMN "serviceDueBasis";
