# Prototype visuel — AutoRappel (module Relances)

Prototype cliquable généré avec OpenDesign à partir du brief `brief-design-autorappel.md`, couvrant les écrans du module relances pour **AtelierOS** (mode `REMINDERS_ONLY`). Sert de référence visuelle — pas de code à réutiliser tel quel (React global/CDN, pas de types, pas branché à `packages/core`/`packages/db`).

## Ouvrir le prototype

Ouvrir `autorappel-app.html` dans un navigateur. Desktop 1440px / mobile 390px, thèmes clair et sombre.

## Correspondance avec le plan de construction

| Écran du prototype                               | Étape (`docs/03-plan-construction.md`) | PRD                                                                      |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| Tableau de bord                                  | 2.4                                    | `docs/modules/M12-tableau-de-bord-rapports.md`                           |
| Relances du jour, Échéances, Modèles de messages | 2.2                                    | `docs/modules/M10-relances-automatiques.md`, `M11-communications.md`     |
| Créances                                         | 2.3                                    | `docs/modules/M09-creances-recouvrement.md`                              |
| Clients, Fiche client, Fiche véhicule            | 1.1                                    | `docs/modules/M02-clients-vehicules.md`                                  |
| Import des données                               | 1.3                                    | `docs/modules/M13-import-integrations-api.md`                            |
| Paramètres (règles de relance, canaux)           | 1.2 / 2.1                              | `docs/modules/M15-parametres-administration.md`, `M11-communications.md` |

## Direction visuelle à reprendre dans `packages/ui`

Tokens couleurs/typo dans `brand-spec.md` et `styles.css` : bleu pétrole/nuit en primaire, orange atelier en accent, statuts vert/orange/rouge/gris (toujours couleur + icône + texte), pastilles de canal WhatsApp/SMS/Email. À adapter aux composants shadcn/ui réels lors de l'implémentation (pas de copier-coller direct du CSS).
