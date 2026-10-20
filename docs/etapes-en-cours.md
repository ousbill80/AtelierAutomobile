# Étapes en cours — registre de réservation

> **Règle (CLAUDE.md, « Travail multi-session », et arbitrage A15)** : avant d'écrire la moindre
> ligne de code pour une étape, une session **demande la réservation à la session d'intégration**,
> seule autorisée à fusionner dans `main` (A15) ; c'est elle qui inscrit la ligne ici, avec la
> migration réservée. Lire ce registre sur `origin/main` (`git fetch origin main`) : si l'étape y
> figure, elle est prise, on en choisit une autre. La ligne est retirée quand la branche est
> fusionnée dans `main` (ou abandonnée, avec la mention dans l'historique).
>
> Origine : le 19/10/2026, M02 et M10 ont été codés deux fois en parallèle par deux sessions
> qui ne se voyaient pas ; la fusion a dû jeter l'une des deux implémentations.

| Étape                                                                      | Branche                     | Session / responsable  | Réservée le | Statut                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| 4.3 — Liens de paiement mobile money (M08) + page facture du portail (M14) | `etape-4.3-paiement-mobile` | session de l'étape 5.1 | 20/10/2026  | en cours — migration `20261020001000_m08_paiement_mobile`                                              |
| 5.3 — Assurances et sinistres (M16)                                        | `etape-5.3-assurances`      | session de l'étape 4.1 | 20/10/2026  | en cours — migration `20261020002000_m16_assurances`                                                   |
| 6.4 (partie 2 seulement) — Synchronisation base externe (M13 §2)           | `etape-6.4-synchro-api`     | session de l'étape 2.4 | 19/10/2026  | **en pause** (A15 point 5 : au plus 2 sessions de développement) — migration `20261019190000_m13_sync` |
