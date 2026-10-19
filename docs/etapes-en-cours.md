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

| Étape                                                            | Branche                   | Session / responsable  | Réservée le | Statut                                                                                                              |
| ---------------------------------------------------------------- | ------------------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| 3.1 — Rendez-vous et planning (M03)                              | `etape-3.1-rendez-vous`   | session de l'étape 3.1 | 19/10/2026  | PR #2 ouverte (fusion de `main` en cours) — migration `20261019180000`                                              |
| 5.1 — Stock et achats (M07)                                      | `etape-5.1-stock`         | session de l'étape 5.1 | 19/10/2026  | **en pause** jusqu'à la fin de la phase 4 (A15 point 5) — PR #4 ouverte, non fusionnée ; migration `20261019182000` |
| 3.3 — Devis et approbation (M05) + portail devis (M14)           | `etape-3.3-devis`         | session de l'étape 3.3 | 19/10/2026  | en cours — migration `20261019184000_m05_devis`                                                                     |
| Reprise des apports M02/M10 de l'ancien `main`                   | `reprise-apports-m02-m10` | session existante      | 19/10/2026  | en cours                                                                                                            |
| 6.4 (partie 2 seulement) — Synchronisation base externe (M13 §2) | `etape-6.4-synchro-api`   | session de l'étape 2.4 | 19/10/2026  | **en pause** jusqu'à la fin de la phase 4 (A15 point 5) — migration `20261019190000_m13_sync`                       |
