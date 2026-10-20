// M14 — libellés du portail (namespace `portal` de messages/fr.json). À importer uniquement dans
// les pages serveur : elles passent le sous-ensemble utile aux composants client, pour ne pas
// embarquer tout fr.json dans le JavaScript des pages client (RG-M14-24, budget 3G).
import fr from "../../../../messages/fr.json";

export type PortalLabels = typeof fr.portal;

export const portalLabels: PortalLabels = fr.portal;
