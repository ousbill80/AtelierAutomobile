# CLAUDE.md — Règles du projet AtelierOS

AtelierOS est un logiciel de gestion d'atelier automobile pour la Côte d'Ivoire : RDV, ordres de réparation, devis, facturation FNE, paiements mobile money, stock, et surtout **relances automatiques** (visite technique, révision, créances) par WhatsApp, SMS et email.

## Avant de coder

1. Lis `docs/00-vision-produit.md`, `docs/01-architecture-technique.md`, `docs/02-modele-donnees.md` et `docs/04-arbitrages-coherence.md`.
2. Lis le PRD du module concerné dans `docs/modules/`.
3. Suis l'étape correspondante de `docs/03-plan-construction.md`.
4. Propose un plan court, puis implémente. Pose une question seulement si un PRD se contredit.

## Travail multi-session (plusieurs agents/devs en parallèle)

- Une étape de `03-plan-construction.md` = une branche Git = une session d'agent (voir `03-plan-construction.md` « Mode d'emploi »).
- Jamais de commit ni de push direct sur `main`. Le code n'atteint `main` que par fusion d'une branche d'étape, après `pnpm check` vert et relecture.
- Avant de committer ou de modifier des fichiers, vérifie `git status` : si une autre session a des changements en cours (sur `main` ou une autre branche) que tu n'as pas toi-même produits, ne commit pas à sa place et ne réécris pas ses fichiers. Attends qu'elle fusionne sa branche, ou prends une étape différente sur une branche séparée.
- Deux sessions ne travaillent jamais sur la même étape en même temps.
- **Réserver avant de coder** : une étape se réserve dans `docs/etapes-en-cours.md` (commit fusionné dans `main`, après `git fetch origin main`) avant toute ligne de code. Étape déjà listée = étape prise. Retirer la ligne à la fusion de la branche.

## Ordre de vérité

`04-arbitrages-coherence.md` > `02-modele-donnees.md` (données) > `00-vision-produit.md` (produit) > `01-architecture-technique.md` (technique) > PRD du module.
En implémentant un module, applique sa section **§14 Évolutions du modèle de données** : mets à jour `schema.prisma` **et** `docs/02-modele-donnees.md` dans le même commit (sans dupliquer un champ déjà créé par un autre module).

## Règles non négociables

- **Multi-locataire** : toute requête passe par `db.forTenant(ctx)`. Jamais de `prisma.x.findMany` brut dans le code applicatif.
- **Permissions** : chaque procédure tRPC et endpoint REST vérifie la permission côté serveur (`requirePermission('module:action')`).
- **Logique métier dans `packages/core`** en fonctions pures testées. Routeurs, jobs et API ne font qu'orchestrer.
- **Argent** : entiers FCFA, jamais de float. Calculs via `core/money`. Affichage `185 000 FCFA`.
- **Téléphones** : normalisés E.164 via `core/phone`.
- **Dates** : UTC en base ; dates métier en `@db.Date` ; affichage `dd/MM/yyyy` dans le fuseau de l'organisation.
- **Factures émises** : immuables. Correction par avoir. Numérotation sans trou via `DocumentSequence`.
- **Relances** : `dedupeKey` unique ; revérifier la condition (facture toujours impayée, VT toujours à faire, pas d'OptOut) **juste avant l'envoi**.
- **Webhooks** : signature vérifiée + idempotence.
- **Secrets fournisseurs** : chiffrés en base, jamais renvoyés au front ni écrits dans les logs.
- **Audit** : actions sensibles → `AuditLog` avec motif.
- **Fournisseurs externes** : toujours derrière une interface de `packages/integrations`, avec une implémentation `console`/`manual` pour le local et les tests. Le code ne doit jamais exiger un compte réel pour tourner.
- **IA** : l'IA propose, l'humain valide toute action à effet (envoi, prix, paiement). Journaliser dans `AiInteraction`.

## Langue

- Interface : **français** uniquement, libellés dans `apps/web/messages/fr.json` (pas de texte en dur dans les composants).
- Code, noms de variables, commits : anglais.
- Messages d'erreur montrés à l'utilisateur : français, clairs, actionnables.

## UI

- shadcn/ui + Tailwind, composants partagés dans `packages/ui` (`StatusBadge`, `MoneyInput`, `PhoneInput`, `PlateInput`, `DataTable`, `EmptyState`).
- Chaque écran : états chargement (squelettes), vide, erreur. Mobile utilisable (390 px). Cibles tactiles ≥ 44 px.
- Statuts : couleur + icône + texte, jamais la couleur seule.

## Tests

- `pnpm check` doit être vert avant de déclarer une étape finie (lint + typecheck + tests).
- Tout ajout dans `packages/core` a des tests unitaires, y compris les cas limites des PRD.
- Chaque module a au moins un test E2E Playwright de son parcours principal.
- Tests d'isolation multi-locataire pour chaque nouveau routeur.
- Temps : utiliser une horloge injectable (`clock.now()`), jamais `new Date()` directement dans `core`.

## Commandes

```
pnpm dev:setup      # première fois : docker, .env, deps, migrations, seed, bucket S3
docker compose -f docker/docker-compose.yml up -d
pnpm dev            # web + worker
pnpm check          # lint + typecheck + tests
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
```

## Définition de « terminé » d'une étape

- Toutes les user stories du périmètre implémentées et leurs critères d'acceptation testés.
- `pnpm check` et E2E verts.
- Pas de `TODO` non tracé ; les écarts au PRD sont listés dans le message de commit.
- Seed mis à jour si de nouvelles données de démo sont utiles.
