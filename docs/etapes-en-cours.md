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

| Étape                                                                                          | Branche                 | Session / responsable                                                | Réservée le | Statut                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 6.3 — Portail client complet (M14) et suivi d'OR en temps réel                                 | `etape-6.3-portail`     | session de l'étape 6.3                                               | 20/10/2026  | en cours — migration `20261020005000_m14_portail`                                                                              |
| 6.5 — Paramètres restants, plans/abonnements, export complet des données (M15)                 | `etape-6.5-parametres`  | session de l'étape 6.5                                               | 20/10/2026  | en cours — migration `20261020006000_m15_parametres`                                                                           |
| 6.4 — Synchronisation base externe, agent local, API publique et webhooks (M13 parties 2 et 3) | `etape-6.4-synchro-api` | session des étapes 5.1/4.3 (reprise de la branche de la session 2.4) | 20/10/2026  | en cours (3e session, sur demande de l'utilisateur) — migration `20261020007000_m13_sync` (remplace `20261019190000_m13_sync`) |
| 6.2b — Suites M17 (get_kpi via dashboard.kpi, faits marquants du digest, bestChannel)          | `etape-6.2b-suites-ia`  | session de l'étape 6.2                                               | 20/10/2026  | en cours (4e session, sur demande de l'utilisateur) — sans migration                                                           |
