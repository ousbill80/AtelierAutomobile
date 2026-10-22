# M18 — Trésorerie

> Complète M08 (caisse, paiements). La caisse d'un site est **un compte de trésorerie parmi d'autres** : M18 donne la vue d'ensemble de tout l'argent du garage (caisses, coffre, banques, portefeuilles mobile money), ses mouvements, ses soldes et ses rapports par période.

## 1. Objectif

Savoir à tout moment **combien d'argent le garage a, où il se trouve et d'où il vient** : soldes par compte, journal unique des entrées et sorties, virements entre comptes (caisse → coffre → banque), dépenses payées hors caisse (loyer, fournisseur, frais bancaires), rapprochement avec les relevés bancaires et mobile money, rapports par jour / semaine / mois exportables.

## 2. Utilisateurs et cas d'usage

| Rôle         | Usage                                                                            | Fréquence    |
| ------------ | -------------------------------------------------------------------------------- | ------------ |
| `OWNER`      | Soldes du jour, évolution, contrôle des écarts et rapprochements                 | Quotidien    |
| `ACCOUNTANT` | Comptes, virements, dépenses hors caisse, rapprochements, rapports et exports    | Quotidien    |
| `MANAGER`    | Consultation des soldes et du journal ; validation des dépenses au-delà du seuil | Hebdomadaire |
| `CASHIER`    | Aucun accès direct : alimente la trésorerie via la caisse (M08)                  | —            |

## 3. User stories

**US-M18-01 — Comptes.** En tant que comptable, je crée les comptes de trésorerie : caisse (une par site, créée automatiquement), coffre (créé automatiquement), banque (nom de la banque, n° de compte masqué à l'affichage), portefeuille mobile money (opérateur), autre. Chaque compte a un solde d'ouverture à une date d'ouverture et les modes de paiement qu'il reçoit.

- Étant donné un compte « Wave marchand » recevant `WAVE`, quand un client paie 85 000 par Wave après la date d'ouverture du compte, alors le solde du compte augmente de 85 000.
- Un mode de paiement n'est rattaché qu'à **un seul** compte actif ; `CASH` va toujours à la caisse du site du paiement.

**US-M18-02 — Encaissements automatiques.** Tout paiement confirmé (M08/M09/liens de paiement) entre dans le compte de son mode ; une annulation ou un chèque rejeté passe une contre-écriture ; un remboursement sort du compte de son mode ; une dépense de caisse validée sort de la caisse du site ; un versement de caisse est un virement caisse → coffre/banque (le caissier choisit le compte) ; l'écart de clôture d'une session est passé en ajustement de la caisse.

- Un encaissement d'un mode sans compte rattaché est signalé « non rattaché » sur la vue d'ensemble et passé dès qu'un compte reçoit ce mode.

**US-M18-03 — Virements.** Je vire 500 000 du coffre vers la banque (référence du bordereau) : le coffre baisse, la banque monte, le total ne change pas.

**US-M18-04 — Dépenses hors caisse.** J'enregistre le loyer (350 000, catégorie « Loyer ») payé depuis la banque, avec justificatif. Au-delà du seuil de validation (RG-M08-30), la dépense attend la validation d'un gérant et ne sort pas du compte avant.

**US-M18-05 — Autres mouvements.** J'enregistre une entrée hors facturation (apport, remboursement d'assurance hors facture, intérêts) ou un ajustement (frais bancaires, retrait) avec catégorie et motif. Une écriture n'est jamais modifiée : on la contre-passe (motif obligatoire).

**US-M18-06 — Rapprochement.** Je saisis le solde du relevé bancaire au 30/09 : l'écran compare avec le solde calculé à cette date et affiche l'écart ; je peux passer l'écart en ajustement (motif obligatoire). Les rapprochements s'affichent sur le compte.

**US-M18-07 — Journal.** Je consulte toutes les entrées et sorties, filtrées par compte, sens, nature, période, recherche (libellé, référence, catégorie) ; chaque ligne mène à sa source quand elle existe (reçu, session de caisse).

**US-M18-08 — Rapports par période.** Pour une période et un compte (ou tous), j'obtiens : solde d'ouverture, entrées, sorties, solde de clôture, ventilation des entrées par mode, des sorties par catégorie, par compte, et une série par jour / semaine / mois ; export CSV et PDF.

## 4. Règles métier

**RG-M18-01 — Comptes.** Types : `CASH_REGISTER` (lié à un site, un par site), `SAFE`, `BANK`, `MOBILE_MONEY`, `OTHER`. Nom unique par organisation. Un compte archivé ne reçoit plus de mouvement ; il ne peut être archivé que si son solde est nul ; une caisse ne s'archive pas. `openingBalance` (entier FCFA, peut être 0) à `openingDate` (date métier), non modifiables après création.

**RG-M18-02 — Rattachement des modes.** `TreasuryAccount.paymentMethods` : un mode (hors `CASH`) appartient à au plus un compte actif. `CASH` → caisse du site du paiement, toujours.

**RG-M18-03 — Grand livre (projection).** `TreasuryMovement` est un grand livre immuable : sens `IN`/`OUT`, montant entier > 0, date, nature, libellé, catégorie, référence, source (`sourceType` + `sourceId`). Les mouvements issus de M08 sont **projetés** depuis leurs sources de façon idempotente (clé unique compte + source + nature) à chaque lecture (vue d'ensemble, journal, rapports) et par le worker ; le compte est figé au moment de la projection. Seules les sources datées **à partir de la date d'ouverture** du compte sont projetées.

| Source (M08)                                          | Mouvement                                            |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Paiement `CONFIRMED` ou `REFUNDED`                    | `IN` `PAYMENT` sur le compte du mode                 |
| Paiement annulé (`voidedAt`) ou `FAILED` déjà projeté | `OUT` `PAYMENT_REVERSAL` sur le même compte          |
| Remboursement                                         | `OUT` `REFUND` sur le compte du mode                 |
| Dépense `APPROVED` (caisse)                           | `OUT` `EXPENSE` sur la caisse du site                |
| Dépense `APPROVED` hors caisse                        | `OUT` `EXPENSE` sur son compte                       |
| Versement de caisse                                   | `OUT` caisse + `IN` compte destination (`CASH_DROP`) |
| Session clôturée avec écart ≠ 0                       | `IN`/`OUT` `CASH_VARIANCE` sur la caisse             |

**RG-M18-04 — Solde.** `solde(compte, t) = openingBalance + Σ IN − Σ OUT` des mouvements datés < t. Le total trésorerie est la somme des comptes actifs.

**RG-M18-05 — Virement.** Comptes distincts et actifs, montant > 0 ; le solde du compte source ne peut pas devenir négatif (sauf `BANK` : découvert toléré, signalé). Deux mouvements `TRANSFER` liés par `transferId`.

**RG-M18-06 — Mouvement manuel.** `INCOME` (entrée) ou `ADJUSTMENT` (entrée ou sortie) : catégorie et motif obligatoires, journalisé dans `AuditLog`. Contre-passation : mouvement inverse lié (`reversalOfId`), une seule fois, motif obligatoire ; pour un virement, les deux jambes. Les mouvements projetés depuis M08 ne se contre-passent pas ici (on corrige la source : annulation de paiement, refus de dépense).

**RG-M18-07 — Rapprochement.** Écart = solde du relevé − solde calculé à la fin du jour du relevé. L'ajustement éventuel est un mouvement `ADJUSTMENT` daté du relevé, lié au rapprochement. Date du relevé ni future, ni antérieure à l'ouverture du compte.

**RG-M18-08 — Rapports.** Période en dates métier (fuseau de l'organisation), bornes incluses, deux ans maximum. Solde d'ouverture = soldes d'ouverture des comptes ouverts au plus tard à la fin de la période + mouvements antérieurs à la période ; les virements internes et versements de caisse sont exclus des totaux « tous comptes » (ils s'annulent) mais visibles par compte.

## 5. Machine à états

Compte : `ACTIVE → ARCHIVED` (solde nul). Mouvement : immuable ; `reversalOfId` pour l'annuler.

## 6. Données

Voir §14 : `TreasuryAccount`, `TreasuryMovement`, `TreasuryTransfer`, `TreasuryReconciliation`, `CashDrop.toAccountId`, `Expense.treasuryAccountId`.

## 7. Écrans et interface

| Route                      | Contenu                                                                                                                                                                               | Actions                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `/tresorerie`              | Total, flux du mois, cartes des comptes (solde, flux du mois, dernier rapprochement, modes reçus), alertes (modes non rattachés, découvert, dépenses en attente), derniers mouvements | Virement, Dépense, Autre mouvement, Nouveau compte |
| `/tresorerie/journal`      | Journal filtrable (compte, sens, nature, période, recherche), totaux de la sélection                                                                                                  | Contre-passer (manuel, virement)                   |
| `/tresorerie/comptes/[id]` | Compte : solde, 30 derniers jours, rapprochements, mouvements                                                                                                                         | Rapprocher, Virement, Modifier, Archiver           |
| `/tresorerie/rapports`     | Période (raccourcis), compte, regroupement jour/semaine/mois : ouverture, entrées, sorties, clôture, graphique, détail, ventilations                                                  | Export CSV, PDF                                    |
| `/caisse` › Versement      | Choix du compte de destination (coffre, banques…)                                                                                                                                     |                                                    |

États chargement / vide / erreur ; mobile 390 px ; cibles ≥ 44 px ; sens = couleur + icône + signe.

## 8. API (tRPC `treasury.*`)

`overview`, `accounts`, `createAccount`, `updateAccount`, `archiveAccount`, `journal`, `transfer`, `createMovement`, `reverseMovement`, `expense`, `uploadExpenseReceipt`, `reconcile`, `account`, `report` ; `cash.dropTargets` ; REST : `GET /api/tresorerie/rapport?from&to&accountId&groupBy&format=csv|pdf`.

## 9. Automatisations et événements

Projection idempotente à la lecture et job worker `treasury.sync` (file `cash`, toutes les 15 min). Événements `treasury.transfer_created`, `treasury.reconciled`.

## 10. Permissions

| Action                                                               | Permission        | Rôles par défaut    |
| -------------------------------------------------------------------- | ----------------- | ------------------- |
| Consulter soldes, journal, rapports                                  | `treasury:read`   | MANAGER, ACCOUNTANT |
| Comptes, virements, mouvements, rapprochements, dépenses hors caisse | `treasury:manage` | ACCOUNTANT          |

OWNER a tout. Validation des dépenses : `cash:expense_approve` (M08).

## 11. Cas limites et erreurs

| Cas                                        | Comportement                                                    |
| ------------------------------------------ | --------------------------------------------------------------- |
| Mode encaissé sans compte                  | Alerte « X encaissements … non rattachés » + création du compte |
| Deux comptes revendiquent Wave             | Refus : « Wave est déjà rattaché au compte … »                  |
| Virement supérieur au solde du coffre      | Refus avec le solde disponible                                  |
| Compte créé aujourd'hui, paiements anciens | Non projetés (antérieurs à la date d'ouverture)                 |
| Paiement annulé après projection           | Contre-écriture automatique, le solde redescend                 |
| Archivage d'un compte non soldé            | Refus : « Soldez le compte avant de l'archiver »                |
| Versement de caisse sans coffre ni banque  | Sortie de caisse passée, alerte « sans compte de destination »  |

## 12. Tests

Unitaires `core/treasury` : résolution de compte, unicité des modes, projection (annulation, date d'ouverture, écarts de clôture, versements), soldes, virements, mouvements manuels, contre-passation, rapprochement, rapports (périodes, exclusion des virements internes). Routeur : projection idempotente, comptes, virement et contre-passation, dépense hors caisse en attente puis validée, annulation de paiement, rapprochement, journal, rapport, isolation multi-locataire. Worker : `treasury.sync`. E2E : compte Wave → compte bancaire → virement → dépense → rapprochement → journal → rapport CSV.

## 13. Définition de « terminé »

- [x] Comptes, projection, virements, mouvements manuels, dépenses hors caisse, rapprochement, journal, rapports + exports.
- [x] Tests unitaires, routeur, worker et E2E.

## 14. Évolutions du modèle de données

Migration `20261022120000_m18_tresorerie` :

```prisma
enum TreasuryAccountType { CASH_REGISTER SAFE BANK MOBILE_MONEY OTHER }
enum TreasuryDirection { IN OUT }
enum TreasuryMovementKind { PAYMENT PAYMENT_REVERSAL REFUND EXPENSE CASH_DROP CASH_VARIANCE TRANSFER INCOME ADJUSTMENT }

model TreasuryAccount {
  id, organizationId, siteId String?, type TreasuryAccountType, name,
  paymentMethods PaymentMethod[], bankName String?, accountRef String?, ledgerAccount String?,
  openingBalance Int @default(0), openingDate DateTime @db.Date, archivedAt DateTime?,
  createdById String?, createdAt, updatedAt
  @@unique([organizationId, name])
}
model TreasuryMovement {
  id, organizationId, accountId, siteId String?, direction, kind, amount Int, occurredAt DateTime,
  label, category String?, reference String?, sourceType String?, sourceId String?,
  transferId String?, counterpartAccountId String?, reversalOfId String? @unique,
  reconciliationId String?, createdById String?, createdAt
  @@unique([organizationId, accountId, sourceType, sourceId, kind])
}
model TreasuryTransfer { id, organizationId, fromAccountId, toAccountId, amount, occurredAt, reference?, notes?, createdById?, createdAt }
model TreasuryReconciliation { id, organizationId, accountId, statementDate @db.Date, statementBalance Int, computedBalance Int, difference Int, notes?, createdById?, createdAt }
// CashDrop.toAccountId String? ; Expense.treasuryAccountId String?
```

RLS `tenant_isolation` sur les quatre nouvelles tables. Permissions `treasury:read`, `treasury:manage`.
