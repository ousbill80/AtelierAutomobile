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

| Étape                                                                                                  | Branche               | Session / responsable   | Réservée le | Statut                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------- | ----------- | -------------------------------------------------------- |
| M08 — caisse et clôture (lot A : validation des dépenses, Z de caisse, historique filtrable, réglages) | `feat/caisse-cloture` | Claude Code (Mouna2507) | 22/10/2026  | En cours — migration `20261022100000_m08_caisse_cloture` |
