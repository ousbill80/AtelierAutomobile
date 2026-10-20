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

| Étape                                                            | Branche                 | Session / responsable  | Réservée le | Statut                                                                                                 |
| ---------------------------------------------------------------- | ----------------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| 4.2 — FNE (M08 §FNE) en mode manual puis api                     | `etape-4.2-fne`         | session de l'étape 4.2 | 19/10/2026  | en cours — migration `20261019210000_m08_fne`                                                          |
| 5.2 — Atelier, mécaniciens et PWA hors-ligne (M06)               | `etape-5.2-atelier`     | session de l'étape 5.2 | 19/10/2026  | en cours — migration `20261019212000_m06_atelier`                                                      |
| 6.4 (partie 2 seulement) — Synchronisation base externe (M13 §2) | `etape-6.4-synchro-api` | session de l'étape 2.4 | 19/10/2026  | **en pause** (A15 point 5 : au plus 2 sessions de développement) — migration `20261019190000_m13_sync` |
