# M08 — Facturation, FNE, paiements, caisse

> Priorité : P0 · Dépend de : M01, M02, M04, M05, M07 (coût des pièces), M11 (envoi), M15 (paramètres fiscaux, fournisseurs) · Consommé par : M09, M10, M12, M14, M16 · Rôles concernés : `CASHIER`, `ADVISOR`, `ACCOUNTANT`, `OWNER`, `MANAGER`

## 1. Objectif

Transformer le travail fait en **argent encaissé et traçable** : factures conformes (numérotation sans trou, TVA, mentions légales, **FNE certifiée par la DGI**), encaissements multi-modes dont le mobile money (Wave, Orange Money, MTN MoMo, Moov) avec liens de paiement et rapprochement automatique, gestion de la caisse physique, et exports comptables SYSCOHADA. C'est la source de vérité des montants dus que M09 et M10 relancent.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Facture un OR terminé, encaisse au comptoir si pas de caissier, envoie facture et lien de paiement | 10 à 40/jour |
| `CASHIER` | Ouvre/clôture la caisse, encaisse, émet les reçus, enregistre les dépenses | Continu |
| `ACCOUNTANT` | Avoirs, suivi FNE, rapprochements, exports comptables | Quotidien / mensuel |
| `OWNER` | Valide annulations, écarts de caisse, consulte encaissements | Quotidien |
| `CUSTOMER` | Reçoit la facture, paie par lien mobile money (M14) | Ponctuel |

## 3. User stories

**US-M08-01 — En tant que conseiller, je veux facturer un OR terminé en un clic.**
- Étant donné l'OR OR-YOP-2026-00042 en `READY` ou `DELIVERED`, quand je clique « Facturer », alors une facture `DRAFT` est créée avec les lignes non annulées, non refusées (`approval ≠ DECLINED`) et `payer = CUSTOMER`, le kilométrage d'entrée, le véhicule et le client ; les lignes `payer = INSURANCE` partent sur la facture assurance (M16) ; les lignes `WARRANTY`/`INTERNAL` ne sont pas facturées.
- Quand j'émets la facture, alors elle reçoit son numéro définitif, ses totaux sont figés, l'OR passe `INVOICED` (M04), l'événement `invoice.issued` est émis et la certification FNE démarre.

**US-M08-02 — En tant que conseiller, je veux créer une facture directe (vente comptoir) ou depuis un devis accepté.**
- Quand je crée une facture sans OR (vente de 2 balais d'essuie-glace), alors le client est obligatoire (client « Comptoir » générique autorisé si `settings.billing.allowWalkIn`), et la sortie de stock est faite à l'émission (M07).
- Depuis un devis `ACCEPTED`/`PARTIALLY_ACCEPTED` sans OR, seules les lignes `accepted = true` sont reprises ; le devis passe `CONVERTED`.

**US-M08-03 — En tant que conseiller, je veux demander un acompte avant de commander une pièce chère.**
- Étant donné un devis de 650 000 FCFA avec une boîte de vitesses à commander, quand je crée une facture d'acompte de 50 000 FCFA TTC, alors une `Invoice` `type = DEPOSIT` est émise (numéro `FAC`, FNE comme toute facture) avec une ligne unique « Acompte sur devis DEV-YOP-2026-00017 » : HT 42 373, TVA 7 627 (RG-M08-07).
- Quand la facture finale est émise, alors l'acompte est déduit par une ligne négative « Déduction acompte FAC-2026-000398 » (HT −42 373, TVA −7 627) et le paiement de l'acompte reste affecté à la facture d'acompte (soldée) : la facture finale a un `total` déjà diminué de 50 000 (ex. 653 720 − 50 000 = 603 720 TTC). Un acompte ne peut être déduit qu'une fois et seulement s'il est payé.

**US-M08-04 — En tant que comptable, je veux corriger une facture émise par un avoir.**
- Étant donné FAC-2026-000412 émise et certifiée FNE, quand je clique « Créer un avoir » (total ou partiel, lignes et quantités sélectionnées) avec motif, alors une `Invoice` `type = CREDIT_NOTE`, numéro `AV-2026-000014`, montants négatifs, `creditedInvoiceId` renseigné, est émise et soumise à la FNE.
- Alors la facture d'origine voit son solde réduit (RG-M08-12) ; si l'avoir est total, elle passe `VOID` avec `voidedAt`/`voidReason`.
- Étant donné une facture `DRAFT`, alors aucun avoir n'est possible : on la modifie ou on la supprime (seuls les brouillons sont supprimables).

**US-M08-05 — En tant que gérant, je veux que chaque facture émise soit certifiée FNE, et être alerté sinon.**
- Étant donné `FneConfig.mode = api`, quand une facture est émise, alors `fneStatus = PENDING` et le job `fne.certify` appelle l'adaptateur ; en cas de succès `fneStatus = CERTIFIED`, `fneNumber`, `fneQrCode`, `fneCertifiedAt` sont enregistrés et le PDF est régénéré avec le QR code.
- Étant donné un échec (réseau, service DGI indisponible), alors `fneStatus = FAILED`, `fneError` est renseigné, le job réessaie (RG-M08-15), et un badge rouge « Non certifiée FNE » s'affiche sur la facture, la liste et le tableau de bord.
- Étant donné `mode = manual`, quand j'ouvre une facture `PENDING`, alors je saisis le numéro FNE et j'importe l'image ou le contenu du QR code obtenus sur la plateforme DGI → `fneStatus = MANUAL`.

**US-M08-06 — En tant que caissier, je veux encaisser un paiement partiel.**
- Étant donné FAC-2026-000415 de 185 000 FCFA, quand M. Kouassi Jean-Marc paie 100 000 en espèces, alors un `Payment` `REC-2026-000310` est créé, alloué de 100 000, `amountPaid = 100 000`, `balance = 85 000`, statut `PARTIALLY_PAID`, un reçu est proposé (impression / WhatsApp), et l'événement `payment.received` est émis (M09 met à jour la créance).

**US-M08-07 — En tant que caissier, je veux répartir un paiement sur plusieurs factures.**
- Étant donné SOTRA Logistique SARL avec 3 factures ouvertes (soldes 240 000, 410 000, 590 000), quand elle vire 800 000 FCFA, alors l'allocation par défaut solde les plus anciennes d'abord (RG-M08-19) : 240 000 + 410 000 + 150 000 ; je peux modifier la répartition avant validation ; la somme allouée ≤ montant ; le reste éventuel devient `unallocated`.

**US-M08-08 — En tant que caissier, je veux gérer un trop-perçu.**
- Étant donné un solde de 85 000 et un paiement Wave de 90 000, alors 85 000 sont alloués, `unallocated = 5 000`, et je choisis : laisser en avoir client (crédit utilisable sur la prochaine facture), ou rembourser (sortie de caisse tracée ou remboursement mobile money manuel, `Refund`).

**US-M08-09 — En tant que conseiller, je veux envoyer un lien de paiement mobile money.**
- Quand je clique « Lien de paiement » sur une facture de solde 85 000, alors un `PaymentLink` est créé via le fournisseur actif (CinetPay ou Wave Business), montant = solde (modifiable vers le bas), expiration 72 h, et envoyé par WhatsApp/SMS via M11 (`{{lien.paiement}}`).
- Quand le client paie, alors le webhook signé crée le `Payment` (méthode selon le canal réel), l'alloue, et le client reçoit son reçu automatiquement.

**US-M08-10 — En tant que comptable, je veux qu'un même paiement Wave ne soit jamais compté deux fois.**
- Étant donné que le fournisseur envoie deux fois le webhook de la transaction `T_8f2a…`, alors un seul `Payment` existe (contrainte `@@unique([provider, providerRef])` + idempotence RG-M08-24) et la seconde réponse est un `200 OK` sans effet.

**US-M08-11 — En tant que caissier, je veux ouvrir et clôturer ma caisse.**
- Quand j'ouvre la caisse du site YOP avec un fond de 50 000 FCFA, alors une `CashSession` est créée ; aucune autre session ouverte n'est permise sur ce site (et pour ce caissier).
- Quand je clôture et compte 612 500 FCFA (détail par billets/pièces facultatif), alors `expectedCash` = fond + encaissements espèces − dépenses − remboursements espèces (RG-M08-28), `difference` est calculé ; un écart ≠ 0 exige un commentaire ; un écart > seuil notifie le gérant.

**US-M08-12 — En tant que caissier, je veux enregistrer une petite dépense** (carburant pour essai, eau, transport pièce) : catégorie, montant, description, photo du justificatif ; elle réduit l'espèce attendue.

**US-M08-13 — En tant que comptable, je veux exporter les écritures au format SYSCOHADA** (journal des ventes, journal des encaissements, journal de caisse) en CSV sur une période (RG-M08-31).

**US-M08-14 — En tant que conseiller, je veux envoyer la facture PDF par WhatsApp ou email** avec un lien portail (M14) permettant de la voir et de la payer.

## 4. Règles métier

### Numérotation et cycle de vie

**RG-M08-01 — Numérotation sans trou.** Le numéro est attribué **à l'émission**, dans la transaction d'émission, via `DocumentSequence` (`SELECT … FOR UPDATE`). Séquences par organisation et année (`siteId = null` : la numérotation fiscale est unique pour l'organisation) : `FAC-2026-000123` (factures et acomptes), `AV-2026-000014` (avoirs), `REC-2026-000310` (reçus/paiements). Si la transaction échoue, le numéro n'est pas consommé. Un brouillon n'a pas de numéro (affiché « Brouillon »). Le changement d'année se fait selon le fuseau de l'organisation.

**RG-M08-02 — Immuabilité.** Une facture émise n'est jamais modifiée sur ses lignes, client, montants ou date. Champs modifiables après émission : `notes` internes, `dueDate` (avec audit, permission `invoice:edit_due`), `status` `DISPUTED` (M09). Les factures émises ne se suppriment jamais (01 §7).

**RG-M08-03 — Date et échéance.** `issuedAt` = horodatage d'émission (pas d'antidatage ; une facture ne peut pas être datée avant la dernière facture émise). `dueDate = date(issuedAt) + Customer.paymentTermsDays` (0 = comptant, échéance le jour même).

**RG-M08-04 — Mentions obligatoires** sur le PDF et contrôlées avant émission (`Organization`) : raison sociale (`legalName`), adresse, téléphone, **RCCM**, **NCC**, régime fiscal (`taxRegime`), n° de facture, date, client (nom, adresse, NCC et RCCM si entreprise), véhicule (plaque, marque, modèle, kilométrage), détail des lignes (désignation, quantité, PU HT, remise, TVA, total), totaux HT/TVA/TTC, montant en lettres (« Cent quatre-vingt-cinq mille francs CFA »), conditions de paiement, bloc FNE (numéro fiscal + QR code) ou mention « FNE en attente de certification ». Si `rccm` ou `ncc` manquent, l'émission est bloquée : « Renseignez le RCCM et le NCC dans Paramètres > Entreprise ».

### Calculs (packages/core/money)

**RG-M08-05 — Calcul par ligne** (entiers FCFA, arrondi au plus proche, demi vers le haut en valeur absolue) :
```
gross       = quantity × unitPrice
lineSubtotal = round(gross × (100 − discountRate) / 100)      // HT net
lineVat      = vatEnabled ? round(lineSubtotal × vatRate / 100) : 0
lineTotal    = lineSubtotal + lineVat
subtotal     = Σ round(gross)                                   // HT brut
discountTotal = subtotal − Σ lineSubtotal
vatTotal     = Σ lineVat ; total = Σ lineTotal
```
Mode alternatif `settings.billing.vatRounding = "total"` : TVA calculée par taux sur la somme des HT. Défaut : `"line"`.

**RG-M08-06 — Exemple chiffré** (TVA 18 %, arrondi par ligne) :

| Ligne | Qté | PU HT | Remise | HT net | TVA | TTC |
|---|---|---|---|---|---|---|
| MO Vidange moteur | 1 | 15 000 | 0 % | 15 000 | 2 700 | 17 700 |
| Huile 5W30 (L) | 4,5 | 6 350 | 0 % | 28 575 | 5 144 | 33 719 |
| Filtre à huile | 1 | 4 750 | 10 % | 4 275 | 770 | 5 045 |
| Plaquettes AV | 1 | 37 900 | 5 % | 36 005 | 6 481 | 42 486 |
| MO plaquettes | 1,5 | 15 000 | 0 % | 22 500 | 4 050 | 26 550 |
| Liquide de frein (L) | 0,5 | 5 900 | 0 % | 2 950 | 531 | 3 481 |
| **Totaux** | | | | **109 305** | **19 676** | **128 981** |

(Huile : 28 575 × 18 % = 5 143,5 → 5 144. Remise totale = 475 + 1 895 = 2 370 ; HT brut 111 675.)

**RG-M08-07 — TTC → HT** (acomptes, montants saisis TTC) : `HT = round(TTC × 100 / (100 + taux))`, `TVA = TTC − HT`. Exemple 50 000 TTC → 42 373 + 7 627.

**RG-M08-08 — Régimes.** Si `Organization.vatEnabled = false` (ex. régime sans TVA), `vatRate` = 0 sur toutes les lignes et la mention « TVA non applicable » est imprimée. Taux par ligne autorisés : 0 ou `Organization.vatRate` (et taux additionnels configurés dans M15).

**RG-M08-09 — Remise globale.** Une remise sur le total est répartie en `discountRate` identique sur chaque ligne (pas de ligne de remise négative), pour garder la TVA juste par ligne. Contrôle prix mini/coût de M07 (RG-M07-13) appliqué.

### Statuts et solde

**RG-M08-10 — Solde.** `amountPaid = Σ PaymentAllocation.amount` (paiements `CONFIRMED`) ; `balance = total − amountPaid − creditedAmount` où `creditedAmount` = Σ |total| des avoirs émis sur la facture. Recalculé dans la transaction de chaque allocation/avoir (`core/receivables/recomputeInvoice`).

**RG-M08-11 — Statut dérivé** (hors `DRAFT`, `VOID`, `WRITTEN_OFF`, `DISPUTED` qui sont posés explicitement) : `balance = 0` → `PAID` ; `0 < balance < total` → `PARTIALLY_PAID` ; sinon `ISSUED` ; `OVERDUE` posé par `receivables.age` si `dueDate < aujourd'hui` et `balance > 0`. `PARTIALLY_PAID` en retard reste `OVERDUE` (M09 lit `balance`).

**RG-M08-12 — Avoir.** Montants de lignes négatifs (même calcul RG-M08-05 avec quantité négative). Un avoir ne peut dépasser le `total − Σ avoirs précédents` de la facture d'origine. Si la facture était déjà payée, l'avoir crée un crédit client (`CustomerCredit`) remboursable ou réutilisable. Avoir total → facture d'origine `VOID`. Un avoir est **toujours** soumis à la FNE (même certifiée par le même adaptateur, type « avoir »).

**RG-M08-13 — Annulation d'une facture certifiée FNE.** Impossible d'« annuler » directement : la seule voie est l'avoir total (RG-M08-12) ; si l'adaptateur expose `cancel`, il n'est utilisé que si la spécification DGI l'exige pour les avoirs. Une facture `PENDING`/`FAILED` (non encore certifiée) suit la même règle : elle est émise et numérotée, donc avoir obligatoire.

### FNE

**RG-M08-14 — Payload.** `core/fne/buildPayload(invoice, organization, customer)` construit un objet neutre (`FneInvoicePayload` : émetteur NCC/établissement/point de vente, client, type de document, lignes HT/TVA/TTC, totaux, mode de paiement, référence de la facture d'origine pour un avoir). L'adaptateur `dgi-api` traduit ce payload vers la spécification fournie par la DGI. **Aucune hypothèse sur les champs exacts de l'API DGI n'est codée hors de l'adaptateur.**

**RG-M08-15 — Retries.** Job `fne.certify` à l'émission ; échec → `FAILED` ; `fne.retry` (toutes les 10 min) re-soumet les factures `FAILED` avec backoff : 10 min, 30 min, 1 h, 2 h, puis toutes les 6 h ; erreurs « définitives » (rejet de validation renvoyé par la DGI) ne sont pas réessayées automatiquement : `fneError` est affiché pour correction (via avoir + nouvelle facture si l'erreur porte sur le contenu). Une clé d'idempotence `invoice.id` est transmise si la spécification le permet, pour éviter une double certification.

**RG-M08-16 — Signalement.** Toute facture émise avec `fneStatus ∈ {PENDING, FAILED}` depuis plus de 1 h → notification `ACCOUNTANT` et `OWNER`, compteur sur le tableau de bord (M12) et filtre « Non certifiées » dans `/factures`. Le PDF porte un filigrane « FNE en attente ». L'envoi au client est autorisé (paramètre `settings.fne.blockSendUntilCertified`, défaut `false`).

**RG-M08-17 — Mode manuel.** `FneConfig.mode = manual` : à l'émission `fneStatus = PENDING` ; l'utilisateur saisit `fneNumber` (obligatoire) et le QR (image importée, stockée en `Attachment kind = "fne_qr"`, ou chaîne décodée) → `MANUAL`. `mode = disabled` (organisation non assujettie, essai) → `NOT_REQUIRED`, mention absente.

### Paiements

**RG-M08-18 — Méthodes.** `CASH`, `WAVE`, `ORANGE_MONEY`, `MTN_MOMO`, `MOOV_MONEY`, `CARD`, `BANK_TRANSFER`, `CHEQUE`, `INSURANCE`, `OTHER`. Référence obligatoire pour mobile money saisi à la main (ID de transaction), chèque (n° + banque), virement. `CASH` exige une `CashSession` ouverte sur le site ; les autres méthodes non (elles sont rattachées à la session ouverte si elle existe, pour le récapitulatif).

**RG-M08-19 — Allocation par défaut** (`core/receivables/allocatePayment`) : factures ouvertes du client triées par `dueDate` croissante puis `issuedAt`, la facture « courante » (celle depuis laquelle on encaisse) en premier ; on solde chacune dans l'ordre jusqu'à épuisement. Invariants : Σ allocations ≤ `amount` ; allocation ≤ `balance` de chaque facture ; `unallocated = amount − Σ allocations`. Un crédit `unallocated` peut être alloué plus tard (`payment.allocate`).

**RG-M08-20 — Chèque.** Statut `PENDING` à la remise, `CONFIRMED` à l'encaissement bancaire (action comptable) ; les allocations d'un paiement `PENDING` ne comptent pas dans `amountPaid` mais la facture affiche « Chèque en attente 85 000 ». Chèque rejeté → `FAILED`, allocations retirées, facture recalculée, événement `payment.failed` (M09 relance).

**RG-M08-21 — Annulation d'un paiement** (erreur de saisie) : permission `payment:void`, motif, `status = REFUNDED` si remboursé ou suppression logique des allocations avec `AuditLog` ; jamais de suppression physique ; le numéro de reçu reste consommé.

**RG-M08-22 — Remboursement** (trop-perçu, avoir payé) : `Refund` lié au paiement ou au crédit, méthode, montant ≤ disponible ; espèces → sortie de la session de caisse ; mobile money → manuel (référence de transfert saisie) en v1.

### Liens de paiement et webhooks

**RG-M08-23 — Création de lien.** `PaymentProvider.createPaymentLink({ invoiceId, amount, customer, expiresAt })`. Montant ≤ `balance` ; un seul lien `PENDING` actif par facture et montant (un nouveau lien expire l'ancien côté application). `expiresAt` défaut 72 h. Les frais éventuels de l'agrégateur ne sont jamais ajoutés au montant client par défaut (`settings.payments.passFeesToCustomer = false`).

**RG-M08-24 — Webhook** `POST /api/webhooks/payments/[provider]/[organizationId]` :
1. Lire le corps brut ; vérifier la signature HMAC-SHA256 avec le secret de `PaymentProviderConfig` (comparaison à temps constant) ; échec → `401`, journalisé.
2. `parseWebhook` → `PaymentEvent { providerRef, status, amount, method, paidAt, raw }`.
3. **Ne jamais faire confiance au webhook seul** : appeler `getStatus(providerRef)` pour confirmer statut et montant.
4. Transaction : `INSERT … ON CONFLICT (provider, providerRef) DO NOTHING` du `Payment` ; si déjà présent → `200` sans effet (idempotence).
5. Allouer à la facture du `PaymentLink` (si la facture est déjà soldée → tout en `unallocated` et alerte « paiement en double probable »).
6. `PaymentLink.status = CONFIRMED`, `paymentId`.
7. Émettre `payment.received` ; reçu envoyé au client.
8. Répondre `200` en < 5 s (traitement lourd en file).
Montant reçu ≠ montant du lien → le montant **réellement confirmé** est enregistré et l'écart signalé.

**RG-M08-25 — Rapprochement.** `payments.reconcile` (30 min) interroge `getStatus` des liens `PENDING` non expirés (et expirés depuis < 24 h) pour rattraper les webhooks perdus ; liens expirés sans paiement → `FAILED`. Écran de rapprochement : import du relevé CSV du fournisseur / du compte marchand, correspondance par `providerRef` puis par (montant, date ± 1 j, téléphone) ; lignes non rapprochées listées.

**RG-M08-26 — Mobile money reçu hors lien** (client envoie sur le numéro marchand Wave du garage) : saisie manuelle `WAVE` avec référence obligatoire ; unicité `(organizationId, method, reference)` vérifiée → « Cette référence Wave a déjà été enregistrée sur REC-2026-000298 ».

### Caisse

**RG-M08-27 — Session.** Une session ouverte maximum par site et par caissier (paramètre : une seule par site). Ouverture : `openingFloat` saisi, proposé = `countedCash − dépôt banque` de la dernière clôture.

**RG-M08-28 — Espèces attendues** : `expectedCash = openingFloat + Σ Payment(CASH, CONFIRMED, session) − Σ Expense(session) − Σ Refund(CASH, session) − Σ CashDrop(session)` (versements en banque / coffre). `difference = countedCash − expectedCash`. Exemple : fond 50 000 + espèces 615 000 − dépenses 12 500 − versement coffre 40 000 = **612 500** attendu ; compté 610 000 → écart **−2 500**.

**RG-M08-29 — Seuils.** Écart |d| > `settings.cash.varianceAlert` (défaut 5 000 FCFA) → notification OWNER. Session non clôturée à 23:00 (fuseau org) → notification caissier et OWNER ; le lendemain, l'ouverture d'une nouvelle session est **bloquée** tant que la précédente n'est pas clôturée (clôture tardive possible par le caissier ou OWNER, horodatée et marquée `lateClose`).

**RG-M08-30 — Dépenses.** Catégories configurables (Carburant, Transport, Achat petite pièce, Restauration, Divers). Montant > `settings.cash.expenseApproval` (défaut 25 000) → validation MANAGER/OWNER. Une dépense d'une session clôturée n'est plus modifiable.

### Exports

**RG-M08-31 — Export SYSCOHADA** (CSV `;`, UTF-8 avec BOM, dates `dd/MM/yyyy`, montants entiers). Colonnes : `Journal;Date;N° pièce;Compte;Compte tiers;Libellé;Débit;Crédit;Référence`. Comptes par défaut (modifiables dans M15) : clients `411`, ventes pièces `701`, prestations de services/MO `706`, TVA facturée `4431`, caisse `571`, banque `521`, mobile money `5xx` paramétrable par opérateur (ex. `585`), dépenses selon catégorie (`6xx`). Journal **VT** : facture = débit 411 TTC / crédit 701 et 706 HT par type de ligne / crédit 4431 TVA ; avoir = écriture inverse. Journal **EN** (encaissements) : débit 571/521/585 / crédit 411. Journal **CA** : dépenses de caisse. Chaque écriture est équilibrée (contrôle avant export ; un écart d'arrondi est impossible car les totaux sont des sommes de lignes figées). Exports additionnels : journal des ventes (liste lisible), encaissements par méthode, état FNE.

## 5. Machines à états

**`InvoiceStatus`**

| De | Vers | Déclencheur | Effets |
|---|---|---|---|
| `DRAFT` | `ISSUED` | `invoice.issue` (ADVISOR, CASHIER, ACCOUNTANT) | numéro, totaux figés, `invoice.issued`, job FNE, OR → `INVOICED`, sorties de stock manquantes (M07) |
| `DRAFT` | (supprimée) | `invoice.deleteDraft` | suppression logique |
| `ISSUED`/`OVERDUE` | `PARTIALLY_PAID` / `PAID` | allocation | `payment.received` |
| `ISSUED`/`PARTIALLY_PAID` | `OVERDUE` | worker `receivables.age` | M09 |
| `PAID`/`PARTIALLY_PAID` | `ISSUED`/`PARTIALLY_PAID` | paiement annulé/chèque rejeté | recalcul |
| tout émis | `VOID` | avoir total | `invoice.voided` |
| `ISSUED`/`PARTIALLY_PAID`/`OVERDUE` | `DISPUTED` ↔ précédent | M09 | |
| `OVERDUE`/`PARTIALLY_PAID` | `WRITTEN_OFF` | M09 (`receivable:writeoff`) | |

**`FneStatus`** : `NOT_REQUIRED` (mode disabled) ; `PENDING → CERTIFIED` (API OK) ; `PENDING → FAILED → PENDING` (retry) ; `PENDING/FAILED → MANUAL` (saisie manuelle). `CERTIFIED`/`MANUAL` sont finaux.

**`PaymentStatus`** : `PENDING` (chèque, lien en cours) → `CONFIRMED` ; `PENDING → FAILED` ; `CONFIRMED → REFUNDED` (remboursé totalement ou annulé avec motif).

**`CashSessionStatus`** (dérivé) : `OPEN` (`closedAt = null`) → `CLOSED` ; `CLOSED → REVIEWED` (OWNER valide l'écart, `reviewedById`).

## 6. Données

Entités de 02 : `Invoice`, `InvoiceLine`, `Payment`, `PaymentAllocation`, `PaymentLink`, `CashSession`, `Expense`, `PaymentProviderConfig`, `FneConfig`, `DocumentSequence`, `Organization` (rccm, ncc, vatRate, vatEnabled, taxRegime, invoiceFooter), `Customer` (paymentTermsDays, ncc, rccm), `RepairOrder`, `RepairOrderLine`, `Quote`, `Attachment`, `AuditLog`, `DomainEvent`.

Ajouts (§14) : `InvoiceLine.costAmount` (coût pour la marge), `InvoiceLine.depositInvoiceId`, `Invoice.creditedAmount`, `Invoice.fneAttempts/fneNextRetryAt`, `Payment.reference` unicité, `Payment.voidedAt/voidReason`, `CashSession` (`lateClose`, `reviewedById`, `denominations`), `CashDrop`, `Refund`, `CustomerCredit`, `PaymentWebhookLog`.

## 7. Écrans et interface

| Route | Contenu | Actions |
|---|---|---|
| `/factures` | Tableau : n°, date, client, véhicule, total, payé, solde, échéance, statut, badge FNE | Filtres (statut, FNE non certifiées, période, site, méthode), recherche, export |
| `/factures/nouvelle` | Éditeur : client/véhicule, lignes (recherche produit/MO, contrôle prix), totaux en direct (RG-M08-05), acomptes disponibles à déduire | Enregistrer brouillon, Émettre (confirmation « La facture ne sera plus modifiable »), aperçu PDF |
| `/factures/[id]` | En-tête statut + FNE, lignes, paiements, avoirs, historique d'envois, audit | Encaisser, Lien de paiement, Envoyer (WhatsApp/email), Imprimer, Avoir, Saisir FNE manuel, Réessayer FNE |
| `/factures/[id]/encaisser` (modale) | Méthode (gros boutons avec logo Wave/OM/MTN/Moov), montant (défaut = solde), référence, allocation multi-factures | Valider → reçu |
| `/caisse` | Session en cours : fond, encaissements par méthode, dépenses, espèces attendues | Ouvrir, Encaisser, Dépense, Versement coffre/banque, Clôturer (comptage par coupures 10 000 / 5 000 / 2 000 / 1 000 / 500 / 250 / 200 / 100 / 50 / 25 / 10 / 5) |
| `/caisse/sessions` | Historique des sessions, écarts, clôtures tardives | Valider écart (OWNER), imprimer Z de caisse |
| `/caisse/paiements` | Tous les paiements (méthode, statut, non alloués) | Allouer, annuler, rembourser, confirmer chèque |
| `/caisse/rapprochement` | Liens en attente, import relevé fournisseur, non rapprochés | Rapprocher, forcer vérification |
| `/factures/exports` | Période, type d'export, aperçu des écritures, contrôle d'équilibre | Télécharger CSV |
| `/p/[token]/facture` (M14) | Facture publique, bouton « Payer avec Wave / Orange Money / MTN / Moov » | Paiement |

PDF (`packages/pdf`) : `InvoicePdf` A4 (et format ticket 80 mm pour les reçus `ReceiptPdf`), logo, mentions RG-M08-04, QR FNE en bas à droite, montant en lettres (`core/money/toFrenchWords`), mention « Pièce fournie par le client » (M07), pied `invoiceFooter`. Envoi WhatsApp : document PDF + lien portail via M11 (modèles `invoice_issued`, `payment_receipt`, `payment_link`).

États : facture `FAILED` FNE → bandeau rouge avec `fneError` en français et bouton « Réessayer » ; caisse fermée → « Ouvrez la caisse pour encaisser en espèces » ; fournisseur de paiement non configuré → lien vers M15.

## 8. API (tRPC)

| Procédure | Entrée | Sortie |
|---|---|---|
| `invoice.createFromRepairOrder` | `{ repairOrderId }` | `{ customerInvoice, insuranceInvoice? }` (brouillons) |
| `invoice.createFromQuote` / `.createDirect` | `{ quoteId }` / `{ siteId, customerId, vehicleId?, lines }` | `Invoice` |
| `invoice.createDeposit` | `{ customerId, quoteId? , repairOrderId?, amountTtc }` | `Invoice` (DRAFT) |
| `invoice.update` | `{ id, lines, notes, dueDate? }` (DRAFT seulement) | `Invoice` |
| `invoice.preview` | `{ lines }` | totaux calculés (RG-M08-05) |
| `invoice.issue` | `{ id, applyDepositIds?: string[] }` | `Invoice` émise |
| `invoice.createCreditNote` | `{ invoiceId, lines: [{ invoiceLineId, quantity }] \| 'FULL', reason }` | avoir émis |
| `invoice.list` / `.get` | filtres + curseur / id | |
| `invoice.send` | `{ id, channels: Channel[], contactIds? }` | messages créés |
| `invoice.pdf` | `{ id }` | URL signée |
| `fne.retry` / `fne.setManual` | `{ invoiceId }` / `{ invoiceId, fneNumber, qrCode?: string, qrImageAttachmentId?: string }` | `Invoice` |
| `payment.create` | `{ siteId, customerId, method, amount, receivedAt?, reference?, allocations?: [{ invoiceId, amount }], notes? }` | `{ payment, receiptUrl }` |
| `payment.suggestAllocation` | `{ customerId, amount, currentInvoiceId? }` | allocations proposées |
| `payment.allocate` | `{ paymentId \| creditId, allocations }` | `Payment` |
| `payment.void` / `.confirmCheque` / `.failCheque` | `{ id, reason }` | `Payment` |
| `refund.create` | `{ paymentId? , creditId?, amount, method, reference? }` | `Refund` |
| `paymentLink.create` / `.cancel` / `.checkStatus` | `{ invoiceId, amount?, expiresInHours?, send?: Channel[] }` | `PaymentLink` |
| `cash.open` / `.current` / `.close` / `.review` | `{ siteId, openingFloat }` / `{ siteId }` / `{ id, countedCash, denominations?, notes? }` / `{ id, comment }` | `CashSession` + récapitulatif |
| `cash.expense` / `cash.drop` | `{ sessionId, category, amount, description, attachmentId? }` / `{ sessionId, amount, destination }` | |
| `reconcile.importStatement` / `.match` | `{ provider, fileUrl }` / `{ lineId, paymentId }` | |
| `accounting.export` | `{ from, to, journal: 'VT'\|'EN'\|'CA'\|'ALL', format: 'syscohada_csv'\|'sales_csv' }` | URL du fichier |

REST : `POST /api/webhooks/payments/[provider]/[organizationId]` (RG-M08-24) ; API publique (M13) `GET /api/v1/invoices`, `GET /api/v1/payments`, `POST /api/v1/payments` (enregistrement par le logiciel existant), scopes `invoice:read`, `payment:write`.

## 9. Automatisations et événements

Émis : `invoice.issued`, `invoice.voided`, `invoice.credit_note_issued`, `invoice.fne_certified`, `invoice.fne_failed`, `payment.received`, `payment.failed`, `payment.refunded`, `cash.session_closed` (avec écart), `cash.session_not_closed`.

Consommés : `repair_order.status_changed` (READY → proposer la facture au conseiller et le lien de paiement dans la notification « véhicule prêt »), `quote.accepted`.

Worker : `fne.certify` (à l'émission), `fne.retry` (10 min), `payments.reconcile` (30 min), `cash.check_unclosed` (23:00), `paymentLinks.expire` (horaire).

IA (M17) : explication en français clair d'une erreur FNE ; suggestion d'allocation quand un virement ne porte pas de référence (rapprochement par libellé) ; détection d'anomalies de caisse (écarts répétés d'un même caissier). Jamais d'action financière sans validation humaine.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir factures | `invoice:view` | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |
| Créer/émettre | `invoice:create` / `invoice:issue` | ADVISOR, CASHIER, ACCOUNTANT, OWNER |
| Avoir | `invoice:credit` | ACCOUNTANT, OWNER |
| Modifier échéance | `invoice:edit_due` | ACCOUNTANT, OWNER |
| FNE manuel / réessayer | `fne:manage` | ACCOUNTANT, OWNER |
| Encaisser | `payment:create` | CASHIER, ADVISOR, ACCOUNTANT, OWNER |
| Annuler un paiement / rembourser | `payment:void` / `payment:refund` | OWNER (+ ACCOUNTANT pour void) |
| Caisse ouvrir/clôturer | `cash:operate` | CASHIER, ADVISOR, OWNER |
| Valider écart de caisse | `cash:review` | OWNER |
| Dépenses | `cash:expense` | CASHIER, OWNER |
| Rapprochement / exports | `payment:reconcile` / `accounting:export` | ACCOUNTANT, OWNER |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Client paie 100 000 sur 185 000 | `PARTIALLY_PAID`, solde 85 000, M09 suit l'échéance ; reçu indique « Reste à payer : 85 000 FCFA » |
| Webhook Wave reçu deux fois | Idempotence RG-M08-24 ; un seul paiement |
| Webhook arrive avant que le client ait fermé la page / ou jamais | Rapprochement 30 min |
| Client paie le lien après avoir payé en espèces | Facture déjà soldée → paiement en `unallocated`, alerte « paiement en double probable », proposition de remboursement ou de crédit |
| Facture à annuler après certification FNE | Avoir total certifié FNE ; facture `VOID` ; jamais de suppression |
| Erreur sur le nom du client après émission | Avoir total + nouvelle facture (bouton « Corriger » qui fait les deux) |
| Service FNE indisponible toute la journée | Factures émises en `FAILED`, retries, badge, alerte ; bascule possible en mode manuel |
| Deux caissiers émettent en même temps | Verrou `DocumentSequence` → numéros consécutifs sans trou |
| Caissier oublie de clôturer | Notification 23:00 ; ouverture suivante bloquée jusqu'à clôture tardive `lateClose` |
| Écart de caisse −2 500 | Commentaire obligatoire ; sous seuil : pas d'alerte ; OWNER voit l'historique des écarts par caissier |
| Signature webhook invalide | `401`, `PaymentWebhookLog` conservé, alerte après 5 échecs/heure |
| Montant webhook différent du lien | Montant confirmé par `getStatus` enregistré, écart signalé |
| Référence Wave saisie deux fois à la main | Bloqué (RG-M08-26) |
| Facture à 0 FCFA (garantie entière) | Émission autorisée si au moins une ligne ; statut `PAID` direct ; FNE selon spec |
| Organisation sans RCCM/NCC | Émission bloquée (RG-M08-04) |
| Avoir supérieur au total restant | « L'avoir ne peut pas dépasser 128 981 FCFA » |
| Changement du taux de TVA en cours d'année | N'affecte que les nouvelles lignes ; factures émises figées |

## 12. Tests

Unitaires (`packages/core/money`, `core/receivables`, `core/numbering`, `core/fne`) :
- `computeLine` / `computeInvoiceTotals` : tableau RG-M08-06 exact (109 305 / 19 676 / 128 981), quantités décimales, remise, TVA désactivée, mode `total`, lignes négatives.
- `ttcToHt` : 50 000 → 42 373 / 7 627 ; 100 000 → 84 746 / 15 254.
- `allocatePayment` : exemple SOTRA (240 000 + 410 000 + 150 000), trop-perçu 5 000, facture courante prioritaire.
- `recomputeInvoice` : statuts dérivés, avoirs partiels, chèque `PENDING`.
- `expectedCash` : exemple RG-M08-28 (612 500, écart −2 500).
- `toFrenchWords` : 185 000, 1 080 080, 71, 80, 91, 200, 1 000 000.
- `buildFnePayload` : facture et avoir.
- `buildSyscohadaEntries` : équilibre débit = crédit, avoir inverse.

Intégration : numérotation concurrente (50 émissions parallèles → aucune duplication ni trou), webhook (signature valide/invalide, doublon, montant différent) avec adaptateur `console`, retry FNE avec adaptateur simulé qui échoue 2 fois, blocage d'ouverture de caisse, isolation multi-locataire (webhook d'une org ne peut pas allouer une facture d'une autre).

E2E Playwright : « OR prêt → facture émise → FNE certifiée (adaptateur manual puis saisie) → encaissement 100 000 espèces → lien de paiement → webhook simulé de 85 000 → facture `PAID`, reçu → clôture de caisse avec écart → export SYSCOHADA équilibré ».

## 13. Définition de « terminé »

- [ ] Factures depuis OR/devis/directes, acomptes, avoirs, numérotation sans trou prouvée par test concurrent.
- [ ] Calculs `core/money` conformes à l'exemple ; PDF avec mentions légales, montant en lettres, QR FNE.
- [ ] FNE : adaptateur isolé (`dgi-api` + `manual`), statuts, retries, signalement des non-certifiées.
- [ ] Paiements multi-modes, partiels, allocation multi-factures, trop-perçu, remboursements, chèques.
- [ ] Liens de paiement CinetPay/Wave derrière `PaymentProvider`, webhook HMAC idempotent, rapprochement.
- [ ] Caisse complète avec clôture, écarts, dépenses, blocage si non clôturée.
- [ ] Exports SYSCOHADA équilibrés ; audit des actions sensibles ; tests verts.

## 14. Évolutions du modèle de données

```prisma
model Invoice {
  // … champs existants
  creditedAmount   Int       @default(0)     // Σ avoirs émis sur cette facture (valeur absolue)
  costTotal        Int       @default(0)     // coût pièces + MO (marge, M12)
  fneAttempts      Int       @default(0)
  fneNextRetryAt   DateTime?
  fneErrorKind     String?                   // transient | rejected
  sentAt           DateTime?
}

model InvoiceLine {
  // … champs existants
  costAmount       Int       @default(0)     // CMP × qté (pièces) ou coût MO, figé à l'émission
  depositInvoiceId String?                   // ligne de déduction d'acompte
  payer            Payer     @default(CUSTOMER)
  repairOrderLineId String?
}

model Payment {
  // … champs existants
  voidedAt         DateTime?
  voidReason       String?
  payerPhone       String?                   // numéro mobile money payeur (rapprochement)
  @@index([organizationId, method, reference])
}

model CashSession {
  // … champs existants
  denominations    Json?                     // { "10000": 42, "5000": 30, … }
  lateClose        Boolean   @default(false)
  reviewedById     String?
  reviewedAt       DateTime?
  @@index([organizationId, siteId, closedAt])
}

model CashDrop {                             // versement coffre / banque depuis la caisse
  id             String   @id @default(cuid())
  organizationId String
  siteId         String
  cashSessionId  String
  amount         Int
  destination    String                      // safe | bank
  reference      String?
  createdById    String?
  createdAt      DateTime @default(now())
}

model Refund {
  id             String   @id @default(cuid())
  organizationId String
  siteId         String
  customerId     String
  paymentId      String?
  customerCreditId String?
  method         PaymentMethod
  amount         Int
  reference      String?
  cashSessionId  String?
  reason         String
  createdById    String?
  createdAt      DateTime @default(now())
}

model CustomerCredit {                        // crédit client issu d'un trop-perçu ou d'un avoir payé
  id             String   @id @default(cuid())
  organizationId String
  customerId     String
  sourceType     String                       // payment | credit_note
  sourceId       String
  amount         Int
  remaining      Int
  createdAt      DateTime @default(now())
  @@index([organizationId, customerId])
}

model PaymentWebhookLog {
  id             String   @id @default(cuid())
  organizationId String?
  provider       String
  providerRef    String?
  signatureValid Boolean
  payload        Json
  outcome        String                       // created | duplicate | rejected | error
  receivedAt     DateTime @default(now())
  @@index([provider, providerRef])
}
```

`PaymentAllocation` : ajouter `customerCreditId String?` (allocation d'un crédit client) et `voidedAt DateTime?`. `DocumentSequence.docType` : `FAC`, `AV`, `REC` avec `siteId = null`. Paramètres `Organization.settings` : `billing.vatRounding`, `billing.allowWalkIn`, `fne.blockSendUntilCertified`, `payments.passFeesToCustomer`, `cash.varianceAlert`, `cash.expenseApproval`, `cash.oneSessionPerSite`, `accounting.accounts` (plan de comptes).
