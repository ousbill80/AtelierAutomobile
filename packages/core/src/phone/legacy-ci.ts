/**
 * Table officielle ARTCI de conversion des anciens numéros ivoiriens à 8 chiffres
 * vers le format à 10 chiffres (réforme de la numérotation, décembre 2021).
 * Clé = 2 premiers chiffres de l'ancien numéro, valeur = 2 chiffres à préfixer
 * pour obtenir le nouveau numéro à 10 chiffres.
 *
 * À compléter avec la table ARTCI complète (04-arbitrages-coherence.md A13).
 * Tant qu'un préfixe n'y figure pas, le numéro à 8 chiffres correspondant est
 * signalé « à vérifier » à l'import au lieu d'être deviné.
 */
export const LEGACY_CI_PREFIX_MAP: Record<string, string> = {};
