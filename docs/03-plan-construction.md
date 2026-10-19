# 03 — Plan de construction (pour Cursor / Claude Code)

> Ordre exact dans lequel construire AtelierOS. Chaque étape est **petite, testable et livrable**. Ne pas sauter d'étape : chaque étape s'appuie sur les précédentes.
> Chaque étape contient un **prompt prêt à coller** dans Cursor (mode Agent) ou Claude Code. Avant chaque prompt, l'agent doit avoir lu `CLAUDE.md`.

---

## Mode d'emploi

1. Une étape = une branche Git = une session d'agent. Jamais de commit direct sur `main`, jamais deux sessions sur la même étape en même temps. **Réserver l'étape dans `docs/etapes-en-cours.md` avant de coder.**
2. Coller le prompt de l'étape. L'agent lit les PRD cités, propose un plan, puis code.
3. L'étape est terminée quand **tous** ses critères de sortie passent (`pnpm check` vert : lint + types + tests).
4. Relire le code, fusionner la branche dans `main`, passer à l'étape suivante.
5. À chaque module, l'agent applique la section §14 « Évolutions du modèle de données » du PRD (voir `04-arbitrages-coherence.md` §1) : mise à jour de `docs/02-modele-donnees.md` **et** de `schema.prisma` dans le même commit.

**Livraisons intermédiaires :**

- **Jalon A (fin phase 2)** — « Relances » : vendable au client pilote en mode `REMINDERS_ONLY` (il garde son logiciel, AtelierOS relance VT, révisions, créances).
- **Jalon B (fin phase 4)** — « Atelier » : gestion complète RDV → OR → devis → facture → paiement.
- **Jalon C (fin phase 6)** — « Pilotage » : stock, mécaniciens, rapports, IA, portail complet.

---

## Phase 0 — Fondations

### Étape 0.1 — Initialisation du monorepo

```
Lis CLAUDE.md, docs/00-vision-produit.md et docs/01-architecture-technique.md.
Initialise le monorepo pnpm + Turborepo exactement selon la structure de 01 §2 :
apps/web (Next.js App Router, TypeScript strict, Tailwind, shadcn/ui), apps/worker (Node + BullMQ),
packages/db, core, validators, ui, integrations, pdf, emails, config.
Ajoute docker/docker-compose.yml (postgres, redis, minio, mailpit), .env.example (01 §9),
scripts : dev, build, lint, typecheck, test, check (= lint+typecheck+test), db:migrate, db:seed.
Configure Vitest, Playwright, ESLint, Prettier, Husky. Ajoute une page d'accueil "AtelierOS" et un test E2E qui la charge.
Critère de sortie : `docker compose up -d && pnpm i && pnpm check && pnpm dev` fonctionne.
```

### Étape 0.2 — Base de données et multi-locataire

```
Lis docs/02-modele-donnees.md et docs/04-arbitrages-coherence.md. Crée packages/db/prisma/schema.prisma à partir du schéma,
plus les champs et modèles listés dans 04 §3
(complète toutes les relations @relation et index pour chaque champ ...Id). Première migration.
Implémente packages/db/tenant.ts : db.forTenant({organizationId}) qui injecte organizationId
partout (extension Prisma) et lève une erreur sans contexte. Active la RLS PostgreSQL (01 §3).
Écris le seed de démonstration (section "Données de démo" ci-dessous).
Tests : isolation A/B (lecture, mise à jour, énumération d'ID impossibles).
```

### Étape 0.3 — Noyau métier transverse

```
Dans packages/core implémente avec tests exhaustifs :
- money : formatFCFA(185000) → "185 000 FCFA", parse ("185 000", "185.000", "185000 F"), calcul de lignes
  (quantité × PU, remise %, TVA par ligne arrondie à l'entier, totaux) — cf. 01 §7 et M08.
- phone : normalisation Côte d'Ivoire vers E.164 (+225 + 10 chiffres), formats tolérés, validation.
- plate : normalisation des plaques.
- numbering : prochain numéro par (org, site, type, année) avec verrou transactionnel, sans trou.
- dates : helpers fuseau organisation, jours ouvrés, jours fériés configurables.
- errors : DomainError typé avec code et message FR.
```

### Étape 0.4 — Authentification, rôles, sites (M01)

```
Lis docs/modules/M01-comptes-roles.md et implémente-le entièrement :
Better Auth, connexion email/téléphone, OTP, invitations, rôles et matrice de permissions,
middleware tRPC requirePermission, multi-sites, journal d'audit, assistant de première configuration.
Layout (app) : barre latérale, sélecteur de site, recherche globale (vide pour l'instant), menu profil.
E2E : créer un garage, inviter un réceptionniste, vérifier qu'il ne voit pas les paramètres.
```

### Étape 0.5 — Adaptateurs et fichiers

```
Dans packages/integrations, crée les interfaces MessagingProvider, PaymentProvider, FneProvider (01 §10),
leurs implémentations console/manual, le registre par organisation (lit ChannelConfig, déchiffre les secrets),
le chiffrement AES-256-GCM, le stockage S3 (MinIO en local) avec URL signées.
Page /dev/outbox (dev uniquement) listant les messages "envoyés" par le provider console.
```

---

## Phase 1 — Clients, véhicules, import

### Étape 1.1 — Clients et véhicules (M02)

```
Implémente docs/modules/M02-clients-vehicules.md : listes, fiches, création/édition, doublons et fusion,
kilométrage et estimation, recherche globale pg_trgm, chronologie 360°.
```

### Étape 1.2 — Paramètres de base (M15, partie 1)

```
Implémente dans docs/modules/M15-parametres-administration.md les sections : garage, sites, ponts, horaires,
jours fériés, TVA, numérotation, mode de fonctionnement (FULL / REMINDERS_ONLY).
```

### Étape 1.3 — Import fichier (M13, partie 1)

```
Implémente l'import Excel/CSV de docs/modules/M13-import-integrations-api.md : téléversement,
détection encodage/séparateur, correspondance des colonnes avec synonymes, normalisation, simulation,
dédoublonnage via ExternalRef/téléphone/plaque, rapport d'erreurs, modèles téléchargeables.
Entités : clients, véhicules (avec dates VT et révision), factures ouvertes (créances), paiements.
Le traitement tourne dans le worker (file imports). E2E : importer tests/fixtures/import-garage.xlsx.
```

---

## Phase 2 — Relances (Jalon A) ⭐ priorité client pilote

### Étape 2.1 — Communications (M11)

```
Implémente docs/modules/M11-communications.md : file d'envoi BullMQ, adaptateurs WhatsApp Cloud API,
lien wa.me, Orange SMS, Twilio, SMTP/Resend ; webhooks de statut et messages entrants signés ;
ordre de repli ; OptOut et STOP ; modèles avec Handlebars et aperçu par canal ; boîte de réception.
```

### Étape 2.2 — Moteur de relances (M10)

```
Implémente docs/modules/M10-relances-automatiques.md en commençant par packages/core/reminders
(fonctions pures + tests de tous les cas limites listés), puis les jobs reminders.plan et reminders.dispatch,
puis l'écran "Relances du jour", les échéances (liste + calendrier), l'éditeur de règles (frise),
les modèles par défaut, l'arrêt automatique et les résultats. Tester avec une horloge simulée.
```

### Étape 2.3 — Créances (M09) et facturation minimale

```
Implémente docs/modules/M09-creances-recouvrement.md. Pour le mode REMINDERS_ONLY, les factures
viennent de l'import : prévois l'enregistrement de paiement manuel (sous-ensemble de M08 : Payment,
PaymentAllocation, recalcul du solde). Balance âgée, dossiers, promesses, litiges, relevé de compte PDF.
```

### Étape 2.4 — Tableau de bord v1 (M12, partie 1)

```
Implémente dans docs/modules/M12-tableau-de-bord-rapports.md : tableau de bord gérant (indicateurs relances
et créances), résultats des relances, résumé quotidien digest.owner, alertes système.
```

### Étape 2.5 — CI et préparation de la démo (Jalon A)

```
Branche la CI GitHub Actions (pnpm check + E2E avec Postgres, Redis et un S3 de test) sur
chaque push et chaque PR ; crée le bucket de stockage à l'installation (docker compose) et un
script `pnpm dev:setup` (install, migrations, seed, bucket) ; documente la répétition de démo
avec un export réel du client pilote. Une fois la CI verte, l'arbitrage A14 (pas de PR) est levé.
```

✅ **Jalon A** : démo au client pilote avec ses propres données importées.

---

## Phase 3 — Atelier

### Étape 3.1 — Rendez-vous et planning (M03)

### Étape 3.2 — Réception et ordres de réparation (M04)

### Étape 3.3 — Devis et approbation (M05) + pages portail devis (M14, partie devis)

```
Pour chacune : "Lis docs/modules/<fichier>.md et implémente-le entièrement, user stories, règles,
écrans, API, permissions, tests et E2E du parcours principal. Respecte CLAUDE.md."
```

---

## Phase 4 — Argent (Jalon B)

### Étape 4.1 — Facturation complète, paiements, caisse (M08)

### Étape 4.2 — FNE (M08 §FNE) en mode manual puis api

### Étape 4.3 — Liens de paiement mobile money (M08) + page facture du portail (M14)

✅ **Jalon B** : le garage peut fonctionner en mode `FULL` du RDV à l'encaissement.

---

## Phase 5 — Opérations

### Étape 5.1 — Stock et achats (M07)

### Étape 5.2 — Atelier, mécaniciens et PWA hors-ligne (M06)

### Étape 5.3 — Assurances et sinistres (M16)

---

## Phase 6 — Pilotage et intelligence (Jalon C)

### Étape 6.1 — Rapports complets (M12)

### Étape 6.2 — IA et automatisations (M17)

### Étape 6.3 — Portail client complet (M14) et suivi d'OR en temps réel

### Étape 6.4 — Synchronisation base externe, agent local, API publique et webhooks (M13 parties 2 et 3)

### Étape 6.5 — Paramètres restants, plans/abonnements, export complet des données (M15)

---

## Phase 7 — Mise en production

### Étape 7.1 — Durcissement

```
Audit sécurité selon 01 §8 : tests d'isolation sur TOUS les routeurs, rate limiting, en-têtes, CSP,
vérification des signatures de webhooks, secrets chiffrés, pas de données sensibles dans les logs.
Performance : index manquants (EXPLAIN sur les listes principales), pagination, poids des pages.
```

### Étape 7.2 — Déploiement

```
Dockerfiles multi-étapes web et worker, docker-compose.prod.yml avec Caddy (HTTPS auto),
sauvegardes PostgreSQL quotidiennes chiffrées hors serveur + test de restauration, Sentry,
healthchecks, script de mise à jour sans coupure, documentation d'exploitation docs/exploitation.md.
```

---

## Données de démo (seed)

Garage **Excellence Auto** (`RSI`, TVA 18 %), site **Yopougon** (code `YOP`) avec 4 ponts, site **Cocody** (code `COC`) avec 2 ponts.

Utilisateurs (mot de passe `demo1234` en local uniquement) : gérant, chef d'atelier, réceptionniste, 3 mécaniciens, magasinier, caissier, comptable.

Clients (au moins 40, dont) :

| Client                | Type                                          | Téléphone      | Véhicule(s)                      | Situation pour tester                              |
| --------------------- | --------------------------------------------- | -------------- | -------------------------------- | -------------------------------------------------- |
| Kouassi Jean-Marc     | Particulier                                   | +2250747218890 | Toyota Corolla 2018, 2547 GH 01  | VT expire dans 15 jours                            |
| Bamba Aminata         | Particulier                                   | +2250566341207 | Hyundai Tucson 2020, 8812 JK 01  | Révision dépassée au km estimé                     |
| SOTRA Logistique SARL | Entreprise, 30 j de crédit, plafond 2 000 000 | +2252722415500 | 6 Toyota Hilux + 6 Isuzu D-Max   | 3 factures impayées, 1 240 000 FCFA, retard 38 j   |
| Koné Ibrahim          | Particulier                                   | +2250152770943 | Peugeot 301 2017, 4421 FD 01     | Facture 185 000 FCFA, retard 12 j, promesse rompue |
| Yao Adjoua Christelle | Particulier, **sans WhatsApp**                | +2250709883165 | Kia Picanto 2021, 1190 LM 01     | VT expirée depuis 6 j (repli SMS)                  |
| Traoré Moussa         | Particulier, **a répondu STOP**               | +2250544109238 | Mitsubishi L200 2019, 6630 HB 01 | Ne doit recevoir aucune relance                    |
| Diabaté Awa           | Particulier, **sans téléphone**               | —              | Suzuki Swift 2019                | Relance impossible → signalée                      |

Catalogue : 30 opérations de MO (vidange, plaquettes, distribution, diagnostic, climatisation…), 120 pièces (filtres, huiles au litre, plaquettes, batteries, pneus…), 5 fournisseurs. 12 mois d'historique d'OR et de factures pour alimenter les rapports.

## Fichiers d'essai d'import

`tests/fixtures/import-garage.xlsx` : export réaliste d'un « ancien logiciel » avec colonnes en français, formats sales (téléphones `07 47 21 88 90`, `0747218890`, `+225 07...` ; dates `02/11/2026`, `2026-11-02`, `2 nov 2026` ; montants `185 000`, `185.000 F`), doublons, lignes vides et 5 lignes en erreur volontaire.
