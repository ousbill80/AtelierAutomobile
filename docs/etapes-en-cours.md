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

| Étape                                                            | Branche                         | Session / responsable  | Réservée le | Statut                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------- | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| 2.4b — Créances × tableau de bord (M12 × M09)                    | `etape-2.4b-dashboard-creances` | session de l'étape 2.4 | 19/10/2026  | intégrée (branche d'intégration), part dans `main` à la prochaine vague                                               |
| 2.5 — CI et préparation de la démo Jalon A                       | `etape-2.5-ci-demo`             | session de l'étape 2.3 | 19/10/2026  | en cours                                                                                                              |
| 3.1 — Rendez-vous et planning (M03)                              | `etape-3.1-rendez-vous`         | session existante      | 19/10/2026  | en cours                                                                                                              |
| 3.2 — Réception et ordres de réparation (M04)                    | `etape-3.2-ordres-reparation`   | session existante      | 19/10/2026  | en cours                                                                                                              |
| 5.1 — Stock et achats (M07)                                      | `etape-5.1-stock`               | session existante      | 19/10/2026  | en cours                                                                                                              |
| Reprise des apports M02/M10 de l'ancien `main`                   | `reprise-apports-m02-m10`       | session existante      | 19/10/2026  | en cours                                                                                                              |
| 6.4 (partie 2 seulement) — Synchronisation base externe (M13 §2) | `etape-6.4-synchro-api`         | session de l'étape 2.4 | 19/10/2026  | en cours — migration `20261019190000_m13_sync` ; partie 3 (API publique, webhooks sortants) reportée après la phase 4 |
