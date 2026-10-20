// M16 §9 — synchronisation du dossier sinistre depuis M04/M08 : implémentation partagée dans
// `@atelieros/db` (aussi appelée par le recalcul de solde des paiements par lien).
export { setClaimStatus, syncClaimFromInvoices, syncClaimFromRepairOrder } from "@atelieros/db";
