# AtelierOS — Dossier PRD

Spécifications complètes d'un logiciel de gestion d'atelier automobile pour la Côte d'Ivoire, prêtes à être construites avec **Cursor** ou **Claude Code**.

## Contenu

| Fichier | Rôle |
|---|---|
| `CLAUDE.md` | Règles que l'agent de code doit suivre (lu automatiquement par Claude Code) |
| `.cursor/rules/atelieros.mdc` | Les mêmes règles pour Cursor |
| `docs/00-vision-produit.md` | PRD maître : problème, vision, personas, modules, parcours de bout en bout, exigences |
| `docs/01-architecture-technique.md` | Stack, structure du dépôt, multi-locataire, permissions, événements, tâches planifiées, sécurité |
| `docs/02-modele-donnees.md` | Schéma Prisma complet, règles d'intégrité, variables des messages |
| `docs/03-plan-construction.md` | Ordre de construction en phases, avec un prompt prêt à coller par étape |
| `docs/04-arbitrages-coherence.md` | Décisions qui tranchent les recouvrements entre modules (prime sur les PRD de modules) |
| `docs/modules/M01…M17` | Un PRD détaillé par module |

## Démarrer

1. Crée un dossier vide, copie-y tout ce dossier (y compris `.cursor/` et `CLAUDE.md`).
2. Ouvre-le dans Cursor (mode Agent) ou lance `claude` dans le dossier.
3. Colle le prompt de l'**étape 0.1** de `docs/03-plan-construction.md`.
4. Avance étape par étape. Ne passe à la suivante que lorsque `pnpm check` est vert.

## Priorité pour le client pilote

Le client garde son logiciel actuel et veut d'abord les **relances** (visite technique, créances, révisions).
Le plan livre donc en premier le **Jalon A** (phases 0 à 2) : import des données de son logiciel + relances automatiques WhatsApp/SMS/email + suivi des créances + tableau de bord. Le reste (atelier complet, stock, IA) suit.
