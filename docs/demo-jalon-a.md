# Démo Jalon A — répétition générale

> Objectif (03, Jalon A) : montrer au client pilote AtelierOS en mode `REMINDERS_ONLY`, **avec ses
> propres données importées** : il garde son logiciel, AtelierOS relance VT, révisions et créances.

## 1. Préparer l'environnement

```bash
pnpm dev:setup     # services docker, .env, dépendances, migrations, seed, bucket S3
pnpm dev           # web (http://localhost:3000) + worker
```

Mode d'envoi : en local, les canaux `console` écrivent dans `/dev/outbox` (aucun message réel).
Pour la démo chez le client, utiliser un environnement hébergé avec des comptes WhatsApp/SMS
**de test** (jamais les vrais clients du garage tant que le pilote n'a pas validé les modèles).

## 2. Répétition avec l'export réel du pilote

| #   | Étape                                                                               | Écran                       | Vérification                                                             |
| --- | ----------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| 1   | Créer l'organisation, finir l'onboarding, passer en `REMINDERS_ONLY`                | `/bienvenue`, `/parametres` | fuseau `Africa/Abidjan`, horaires, jours fériés                          |
| 2   | Importer clients + véhicules (fichier du pilote)                                    | `/import`                   | lignes en erreur listées, numéros normalisés E.164, plaques reconnues    |
| 3   | Importer les factures ouvertes                                                      | `/import`                   | soldes = ceux du logiciel du pilote (contrôle sur 5 clients)             |
| 4   | Lancer `receivables.age` puis `reminders.plan` (ou attendre 01:00 / l'heure pleine) | `/creances`, `/relances`    | balance âgée = somme des soldes ; dossiers ouverts ; relances planifiées |
| 5   | Parcourir les relances « à valider »                                                | `/relances`                 | ton, montants, dates `dd/MM/yyyy`, montants `185 000 FCFA`               |
| 6   | Enregistrer un paiement sur un dossier                                              | `/creances/[id]`            | facture payée, dossier soldé, relance planifiée annulée                  |
| 7   | Noter une promesse, puis simuler son échéance dépassée                              | `/creances/[id]`            | relance « promesse non tenue » créée une seule fois                      |
| 8   | Tableau de bord                                                                     | `/`                         | indicateurs relances et créances cohérents avec 4 et 6                   |

Consigner chaque écart (donnée mal importée, libellé, montant) dans une issue avant la démo.

## 3. Points d'attention connus

- Le bucket S3 doit exister (créé par `pnpm dev:setup` / service `s3-init`, ou à la main en hébergé ; en dev le stockage est l'émulateur moto, en mémoire).
- Une base créée avant le 19/10/2026 (ancien historique de migrations M02/M10) doit être recréée :
  `pnpm --filter @atelieros/db exec prisma migrate reset`, puis `pnpm db:seed`.
