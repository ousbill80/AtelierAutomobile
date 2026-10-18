# M12 — Tableau de bord et rapports

> Priorité : P0 · Dépend de : M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11 (lecture seule de leurs données), M15 (paramètres), M17 (phrase « faits marquants » optionnelle) · Rôles concernés : OWNER, MANAGER, ADVISOR, ACCOUNTANT, CASHIER

## 1. Objectif

Donner au gérant, en 10 secondes, l'état de son garage : ce qui rentre, ce qui bloque, qui doit de l'argent et ce que les relances ont rapporté. Chaque indicateur a **une seule définition** (formule, période, filtre site), calculée côté serveur dans `packages/core/reports`, pour que le tableau de bord, les rapports exportés, le résumé quotidien et l'assistant IA (M17) affichent **exactement les mêmes chiffres**. Le module produit aussi les rapports exportables (Excel/PDF), la comparaison multi-sites et les alertes.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| OWNER | Consulte le tableau de bord sur téléphone, lit le résumé quotidien WhatsApp, compare les sites, exporte les rapports | Quotidien |
| MANAGER | Suit les OR en cours, l'occupation des ponts, l'efficacité des mécaniciens | Plusieurs fois par jour |
| ADVISOR | Voit RDV du jour, relances à valider, devis en attente, véhicules prêts | Continu |
| ACCOUNTANT | Encaissements par mode, balance âgée, DSO, exports | Quotidien / mensuel |
| CASHIER | Encaissements du jour de sa caisse | Quotidien |

## 3. User stories

**US-M12-01 — En tant que gérant, je veux un tableau de bord mobile qui affiche CA, encaissements, créances et résultats des relances afin de savoir en 10 secondes où en est le garage.**
- Étant donné que je suis OWNER et que j'ouvre `/tableau-de-bord` sur un écran de 390 px, quand la page charge, alors je vois en premier 4 cartes (CA HT du mois, Encaissé du mois, Créances en cours dont > 30 j, Récupéré grâce aux relances 30 j), chacune avec la variation vs période précédente, en moins de 1,5 s sur 3G (données issues du cache).
- Étant donné que je touche la carte « Créances en cours », alors j'arrive sur `/creances` filtré sur « en retard ».

**US-M12-02 — En tant qu'utilisateur, je veux choisir la période et le site afin d'analyser une situation précise.**
- Étant donné les sélecteurs Période (Aujourd'hui, 7 j, Mois en cours, Mois précédent, 30 j, Trimestre, Année, Personnalisée) et Site (Tous / un site autorisé), quand je change un filtre, alors tous les blocs se recalculent et l'URL contient `?periode=mois&site=YOP` (partageable).
- Étant donné que mon `Membership.siteIds = ["site_yop"]`, alors le sélecteur ne propose que Yopougon et « Tous les sites » n'existe pas.

**US-M12-03 — En tant que chef d'atelier, je veux un tableau de bord atelier afin d'organiser la journée.**
- Étant donné que je suis MANAGER, quand j'ouvre le tableau de bord, alors je vois par défaut l'onglet « Atelier » : OR par statut (compteurs cliquables), OR en retard sur `promisedAt`, taux d'occupation du jour, efficacité par mécanicien sur 7 j, OR en `WAITING_PARTS` depuis > 48 h.

**US-M12-04 — En tant que réceptionniste, je veux voir ce que j'ai à faire maintenant.**
- Étant donné que je suis ADVISOR, alors l'onglet « Accueil » affiche : RDV du jour (heure, client, plaque, statut), relances `NEEDS_APPROVAL` (5 premières + « Tout voir »), devis `SENT`/`VIEWED` sans décision depuis > 48 h, véhicules `READY` non livrés.

**US-M12-05 — En tant que comptable, je veux exporter la balance âgée en Excel à une date donnée.**
- Étant donné que je choisis « Balance âgée » au 30/09/2026 et « Excel », quand je clique « Exporter », alors un fichier `balance-agee_2026-09-30_Garage-Excellence-Auto.xlsx` est généré (asynchrone si > 5 000 lignes) avec une ligne par facture ouverte et un onglet de synthèse par client, et les totaux sont identiques à ceux affichés à l'écran.

**US-M12-06 — En tant que gérant, je veux savoir combien les relances ont rapporté, avec une règle claire.**
- Étant donné qu'une relance créance J+15 sur FAC-2026-000412 (185 000 FCFA) est envoyée le 03/10/2026 à 9 h 00 et qu'un paiement Wave de 185 000 FCFA est alloué à cette facture le 06/10/2026, alors « Récupéré grâce aux relances » inclut 185 000 FCFA pour octobre et le détail affiche la relance attributaire.
- Étant donné qu'un paiement arrive 20 jours après la dernière relance, alors il n'est pas attribué (fenêtre par défaut 14 j).

**US-M12-07 — En tant que gérant d'un réseau, je veux comparer mes sites.**
- Étant donné une organisation de 2 sites ou plus et la permission `dashboard:owner`, quand j'ouvre `/rapports/comparaison-sites`, alors je vois un tableau sites × indicateurs (CA HT, marge globale %, panier moyen, nb OR, taux d'acceptation, occupation, efficacité, encours, DSO) avec la ligne « Réseau » et le classement par indicateur.

**US-M12-08 — En tant que gérant, je veux recevoir un résumé chaque matin.**
- Étant donné `settings.digest.enabled = true`, canal WhatsApp, heure 07:30, quand la tâche `digest.owner` s'exécute, alors je reçois un message conforme à RG-M12-30, une seule fois par jour (clé de dédoublonnage `digest:{membershipId}:{date}`).

**US-M12-09 — En tant que gérant, je veux être alerté des situations anormales.**
- Étant donné qu'une caisse est clôturée avec un écart de −12 500 FCFA, alors une notification « Écart de caisse −12 500 FCFA — Atelier Yopougon » m'est créée immédiatement et apparaît dans le bloc Alertes.

**US-M12-10 — En tant que garage en mode « Relances seules », je veux un tableau de bord adapté.**
- Étant donné `Organization.operatingMode = REMINDERS_ONLY`, alors le tableau de bord affiche la version AutoRappel : relances à traiter aujourd'hui, créances en cours (dont > 30 j), VT expirant sous 30 j, révisions dues ce mois, bloc résultats des relances, top 5 impayés, alertes système ; aucun bloc OR/atelier/stock.

## 4. Règles métier

### 4.1 Conventions communes

- **RG-M12-01 — Période.** Une période est `[from, to)` exprimée en dates locales du fuseau `Organization.timezone`, convertie en UTC pour les requêtes. « Mois en cours » = du 1er du mois à aujourd'hui inclus. **Période de comparaison** = période précédente de même durée (mois en cours du 1er au 18 → du 1er au 18 du mois précédent). Variation % = `round((v - v_prec) / v_prec × 100)` ; si `v_prec = 0` → afficher « nouveau » sans pourcentage.
- **RG-M12-02 — Filtre site.** Chaque fait porte un `siteId` : facture → `Invoice.siteId` ; paiement → `Payment.siteId` ; OR, devis, RDV → leur `siteId` ; pointage → `siteId` de l'OR ; relance → `siteId` de la facture (RECEIVABLE), du RDV ou de l'OR attribué, sinon **non attribuable** (comptée uniquement dans « Tous les sites »). Le filtre est toujours intersecté avec `Membership.siteIds`.
- **RG-M12-03 — Factures prises en compte.** « Facture valide » = `type = INVOICE`, `status IN (ISSUED, PARTIALLY_PAID, PAID, OVERDUE, DISPUTED, WRITTEN_OFF)`, `issuedAt` dans la période. Les `DEPOSIT` (acomptes) sont exclus du CA (ils seront repris dans la facture finale). Les avoirs (`CREDIT_NOTE`, montants positifs) émis dans la période sont **soustraits**. `VOID` et `DRAFT` exclus.
- **RG-M12-04 — Arrondis.** Tous les montants sont des entiers FCFA. Les taux sont calculés en flottant puis arrondis à 1 décimale à l'affichage. Une division par zéro affiche « — ».

### 4.2 Définition exacte des indicateurs

| Code | Indicateur | Formule | Période / instant |
|---|---|---|---|
| RG-M12-05 `revenue_ht` | CA HT | `Σ InvoiceLine.lineSubtotal` des factures valides − `Σ lineSubtotal` des avoirs émis. Si une facture importée n'a pas de lignes (`origin = IMPORTED`, cf. M13), utiliser `Invoice.subtotal − Invoice.discountTotal`. `lineSubtotal` est net de remise (M08). | `issuedAt` dans la période |
| RG-M12-06 `revenue_ttc` | CA TTC | idem avec `lineTotal` (ou `Invoice.total`). | idem |
| RG-M12-07 `revenue_by_type` | CA par nature | CA HT ventilé par `InvoiceLine.type` : MO (`LABOR`), Pièces (`PART` + `CONSUMABLE`), Sous-traitance (`SUBCONTRACT`), Frais (`FEE`). | idem |
| RG-M12-08 `parts_margin` | Marge pièces | `Σ (lineSubtotal − quantity × unitCost)` sur lignes PART/CONSUMABLE. `unitCost` = CMP figé au moment de la sortie : moyenne pondérée des `StockMovement` `ISSUE_TO_RO` (net des `RETURN_FROM_RO`) du même `productId` et du même `repairOrderId` ; à défaut `Product.averageCost` actuel et la ligne est marquée « coût estimé ». Taux = marge / CA pièces. | idem |
| RG-M12-09 `labor_margin` | Marge MO | CA MO − coût MO. Coût MO = `Σ heures pointées × Membership.hourlyCost` des `TimeEntry` des OR rattachés aux factures valides de la période. Heures pointées d'une entrée = `(endedAt − startedAt) en minutes − pauseMinutes`, ÷ 60, entrées `endedAt = null` ignorées. `hourlyCost` nul → `settings.costs.defaultMechanicHourlyCost` (défaut 2 500 FCFA/h) et marquage « coût estimé ». | idem |
| RG-M12-10 `gross_margin` | Marge globale | marge pièces + marge MO + CA frais + CA sous-traitance (coût sous-traitance non suivi en v1, signalé « hors coût »). Taux = marge globale / CA HT. | idem |
| RG-M12-11 `avg_ticket` | Panier moyen | CA HT / nombre de factures valides de type INVOICE (avoirs non comptés au dénominateur). | idem |
| RG-M12-12 `ro_counts` | Nombre d'OR | **Ouverts** : `createdAt` dans la période, `status ≠ CANCELLED`, `deletedAt null`, `origin ≠ IMPORTED`. **Livrés** : `deliveredAt` dans la période. **En cours (instantané)** : statut ∉ {DRAFT, DELIVERED, INVOICED, CANCELLED} à l'instant présent. | période / instant |
| RG-M12-13 `quote_acceptance` | Taux d'acceptation des devis | Univers : **dernière version** de chaque numéro de devis, décidée dans la période (`decidedAt` dans la période, ou `validUntil` dans la période pour `EXPIRED`). En nombre : `(ACCEPTED + PARTIALLY_ACCEPTED + CONVERTED) / (ACCEPTED + PARTIALLY_ACCEPTED + CONVERTED + DECLINED + EXPIRED)`. En valeur : `Σ total TTC des QuoteLine accepted = true / Σ Quote.total` de l'univers. Les deux sont affichés ; la carte montre la valeur en nombre. | décision |
| RG-M12-14 `bay_occupancy` | Taux d'occupation des ateliers | **Réel** = heures pointées sur le site / capacité. **Planifié** = `Σ durée (endsAt − startsAt)` des `Appointment` avec `bayId`, statut ∉ {CANCELLED, NO_SHOW} / capacité. Capacité = `Σ ponts actifs (Bay.isActive, type ≠ WASH)` × heures d'ouverture du site (`Site.openingHours`) sur la période, jours fériés (`Holiday`, M15) exclus. Plafonné à 100 % à l'affichage, valeur brute dans l'export. | période |
| RG-M12-15 `tech_efficiency` | Efficacité mécanicien | Heures vendues / heures pointées. Heures vendues = `Σ RepairOrderLine.quantity` (type LABOR, `assignedToId` = mécanicien, `status = DONE`) des OR facturés dans la période. Heures pointées = sur ces mêmes lignes. Objectif affiché ≥ 100 %. | facturation |
| RG-M12-16 `tech_productivity` | Productivité | Heures pointées sur OR / heures de présence (`Attendance.clockOut − clockIn`). **Rendement global** = heures vendues / heures de présence. | période |
| RG-M12-17 `receivables` | Créances en cours | `Σ Invoice.balance` des factures INVOICE `status IN (ISSUED, PARTIALLY_PAID, OVERDUE, DISPUTED)` à l'instant T. **En retard** : `dueDate < T`. **> 30 j** : `T − dueDate > 30`. Les `DISPUTED` sont comptées mais montrées à part. | instant |
| RG-M12-18 `aged_balance` | Balance âgée | Tranches sur jours de retard `d = T − dueDate` : Non échu (`d ≤ 0`), 1–30, 31–60, 61–90, > 90. À une date passée T, le solde est reconstitué : `total − Σ allocations des paiements reçus ≤ T` pour les factures émises ≤ T. | instant (date choisie) |
| RG-M12-19 `dso` | DSO (délai moyen d'encaissement) | `round(encours TTC à T / CA TTC des 90 jours précédant T × 90)` en jours. CA TTC nul → « — ». | instant, fenêtre 90 j |
| RG-M12-20 `collected` | Encaissements | `Σ Payment.amount` `status = CONFIRMED`, `receivedAt` dans la période, ventilé par `method`. Les remboursements (`REFUNDED`) sont affichés en négatif sur leur date de mise à jour. Les règlements de reprise de solde importés (`origin = IMPORTED` avec `reference = 'OPENING'`) sont exclus. | `receivedAt` |
| RG-M12-21 `recovered_by_reminders` | Montant récupéré grâce aux relances | Voir RG-M12-22. | `receivedAt` |
| RG-M12-23 `reminder_return_rate` | Taux de retour VT / révision | Voir RG-M12-24. | cohorte |
| RG-M12-25 `active_customers` | Clients actifs / nouveaux / perdus | Activité = au moins une facture valide ou un OR non annulé (dates `issuedAt`/`createdAt`). **Actifs** : activité dans les 12 mois précédant la fin de période. **Nouveaux** : première activité de l'historique dans la période. **Perdus** : activité entre 24 et 12 mois avant la fin de période, aucune dans les 12 derniers mois. | fin de période |
| RG-M12-26 `top_parts` | Top pièces | Lignes PART des factures valides, groupées par `productId` (sinon par `description` normalisée), triées par CA HT puis quantité ; colonnes : quantité, CA HT, marge, nb OR. Top 10 au tableau de bord, complet en rapport. | `issuedAt` |

### 4.3 Attribution aux relances

- **RG-M12-22 — Montant récupéré (créances).** Une `PaymentAllocation` (paiement `CONFIRMED`) d'un montant A sur la facture I est attribuée à une relance R si : `R.type = RECEIVABLE`, `R.status = SENT`, (`R.invoiceId = I` **ou** `R.invoiceId = null` et `R.customerId = Invoice.customerId`), et `R.sentAt ≤ Payment.receivedAt ≤ R.sentAt + N jours` avec `N = settings.reports.attributionWindowDays` (défaut **14**). Règle **dernier contact** : si plusieurs relances éligibles, la plus récente gagne. Un paiement passé par un `PaymentLink` créé depuis le message d'une relance est attribué à cette relance même au-delà de N. Chaque allocation est attribuée au plus une fois. Le montant attribué est `A` (pas le montant du paiement). La fonction pure `attributePayment()` dans `core/reports/attribution.ts` est **aussi** utilisée par M10 pour renseigner `Reminder.outcome = PAID | PARTIALLY_PAID`.
  *Exemple* : SOTRA Logistique doit 1 240 000 FCFA ; relance J+30 le 01/10 ; virement de 600 000 FCFA le 08/10 alloué à 2 factures → 600 000 FCFA récupérés, outcome `PARTIALLY_PAID`.
- **RG-M12-24 — Taux de retour VT / révision.** Cohorte = couples distincts `(vehicleId, dueDate)` ayant au moins une relance `SENT` de type INSPECTION (resp. SERVICE) et dont `dueDate` est dans la période. **Retour** si, pour ce véhicule, un `Appointment` (statut ARRIVED ou COMPLETED) ou un `RepairOrder` (non annulé) a été créé entre la **première** relance envoyée et `dueDate + G` jours (G = 30 pour VT, 60 pour révision). Taux = retours / cohorte. Les échéances dont `dueDate + G` n'est pas encore passé sont affichées « en cours » et exclues du taux. Le **CA généré** par ces retours = CA HT des factures des OR concernés (affiché à part, jamais additionné au montant récupéré des créances).

### 4.4 Alertes

- **RG-M12-27 — Alertes calculées.** Chaque alerte crée une `Notification` (type `alert.<code>`) pour les destinataires configurés, dédoublonnée par `dedupeKey` (une fois par objet et par jour) :

| Code | Condition (défauts modifiables dans `settings.alerts`) | Destinataires |
|---|---|---|
| `cash_difference` | `CashSession.difference ≠ 0` et `|difference| ≥ 1 000` | OWNER, ACCOUNTANT |
| `receivable_45d` | Facture en retard > 45 j (aligné sur palier « alerte gérant » M10) | OWNER |
| `credit_limit` | Encours client > `Customer.creditLimit` | OWNER, ACCOUNTANT |
| `promise_broken` | `PaymentPromise` passée à `BROKEN` | OWNER, assigné du dossier |
| `fne_failed` | Facture `fneStatus = FAILED` depuis > 24 h | ACCOUNTANT, OWNER |
| `stock_below_min` | Événement `stock.below_minimum` | STOREKEEPER |
| `ro_ready_not_delivered` | OR `READY` depuis > 3 jours | ADVISOR, MANAGER |
| `ro_late` | `promisedAt < now` et statut ∉ {READY, DELIVERED, INVOICED, CANCELLED} | MANAGER |
| `channel_error` | `ChannelConfig.status = ERROR` ou > 10 % de messages `FAILED` sur 24 h (min. 20 envois) | OWNER |
| `sms_balance_low` | `ChannelConfig.balance < 500` | OWNER |
| `import_stale` | Source de données active sans exécution réussie depuis > 3 jours | OWNER |
| `discount_high` | Remise de ligne > `settings.discounts.maxRateWithoutApproval` (défaut 15 %) sur facture émise | OWNER |

- **RG-M12-28 — Bloc Alertes.** Affiche les 5 alertes non lues les plus récentes, triées par sévérité (`critical` > `warning` > `info`) puis date ; « Marquer comme lu » met `Notification.readAt`.

### 4.5 Cache et calcul

- **RG-M12-29 — Stratégie de calcul.**
  1. **Vues SQL** (non matérialisées, `security_invoker = true` pour respecter la RLS) : `v_fact_invoice_line`, `v_fact_payment_allocation`, `v_fact_time_entry`, `v_fact_quote_decision`, `v_open_invoice`.
  2. **Agrégat journalier** `KpiDaily` (§14) par `(organizationId, siteId, date)` contenant les **numérateurs et dénominateurs** de tous les indicateurs additifs (jamais de ratio stocké). Calculé par la tâche `reports.rollup` à 01:30 (heure locale) pour J−1, et recalculé pour une date passée lorsqu'un événement la modifie (avoir, paiement antidaté, import).
  3. Pour une période, `core/reports` somme les `KpiDaily` puis calcule les ratios ; le **jour courant** est calculé en direct sur les vues.
  4. Les indicateurs instantanés (encours, OR en cours, balance âgée à aujourd'hui) sont calculés en direct.
  5. **Cache Redis** de la réponse `dashboard.get` : clé `dash:{orgId}:{role}:{siteId|all}:{periodKey}`, TTL 5 min, invalidé sur `invoice.issued/voided`, `payment.received`, `repair_order.status_changed`.
  ```sql
  CREATE VIEW v_fact_invoice_line WITH (security_invoker = true) AS
  SELECT i."organizationId", i."siteId", i.id AS invoice_id, i."repairOrderId", i."customerId",
         i."issuedAt", i.type AS invoice_type, l.type AS line_type, l."productId",
         l.quantity, l."lineSubtotal", l."lineTotal",
         CASE WHEN i.type = 'CREDIT_NOTE' THEN -1 ELSE 1 END AS sign
  FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
  WHERE i.type IN ('INVOICE','CREDIT_NOTE')
    AND i.status IN ('ISSUED','PARTIALLY_PAID','PAID','OVERDUE','DISPUTED','WRITTEN_OFF');
  ```

### 4.6 Résumé quotidien

- **RG-M12-30 — Contenu exact du résumé gérant** (WhatsApp ≤ 1 000 caractères ; email = même contenu + tableaux). Sections omises si vides ; chiffres du site filtré par `Membership.siteIds`.
  ```
  ☀️ Garage Excellence Auto — samedi 18/10/2026
  HIER : CA 1 245 000 FCFA HT · encaissé 980 000 FCFA (Wave 520 000 · Espèces 310 000 · OM 150 000)
  OR : 9 ouverts · 7 livrés · 14 en cours
  AUJOURD'HUI : 11 RDV · 5 véhicules promis · 2 OR bloqués (pièces > 48 h)
  ARGENT DEHORS : 4 850 000 FCFA dont 1 920 000 à +30 j
  Promesses attendues aujourd'hui : 2 (310 000 FCFA)
  RELANCES : 23 à valider · 3 échecs d'envoi
  Récupéré grâce aux relances : 185 000 FCFA hier · 2 300 000 FCFA sur 30 j
  ⚠️ Écart de caisse −12 500 FCFA (Yopougon)
  💡 <phrase « faits marquants » M17, si activée et disponible>
  Détails : https://app.atelieros.ci/tableau-de-bord
  ```
  « Hier » = jour local précédent. En mode REMINDERS_ONLY, les lignes CA/OR/RDV sont remplacées par « VT sous 30 j : 41 · Révisions dues ce mois : 37 ». Envoi par M11 (message transactionnel interne, pas soumis à `OptOut`) ; si WhatsApp échoue → email.

## 5. Machine à états

`ReportExport.status` : `PENDING → RUNNING → READY | FAILED` ; `READY → EXPIRED` après 7 jours (fichier supprimé du stockage). Seul le worker change le statut ; relance manuelle possible depuis `FAILED`.

## 6. Données

Lecture : `Invoice`, `InvoiceLine`, `Payment`, `PaymentAllocation`, `PaymentLink`, `RepairOrder`, `RepairOrderLine`, `TimeEntry`, `Attendance`, `Membership`, `Quote`, `QuoteLine`, `Appointment`, `Bay`, `Site`, `StockLevel`, `StockMovement`, `Product`, `Reminder`, `Message`, `CollectionCase`, `PaymentPromise`, `CashSession`, `Vehicle`, `Customer`, `Holiday` (M15).
Écriture : `KpiDaily`, `ReportExport`, `Notification` (alertes), `AuditLog` (exports).
Paramètres (`Organization.settings`) : `reports.attributionWindowDays`, `costs.defaultMechanicHourlyCost`, `alerts.*`, `digest.{enabled, time, channel, recipients[]}`, `dashboard.defaultPeriod`.

## 7. Écrans et interface

**`/tableau-de-bord`** — En-tête : sélecteurs Période et Site (sticky sur mobile), bouton « Actualiser » (force le recalcul, limité à 1/min). Onglets selon le rôle (l'OWNER voit tous les onglets) :

| Onglet | Rôle par défaut | Blocs |
|---|---|---|
| Synthèse | OWNER | 4 cartes KPI (CA HT, Encaissé, Créances dont > 30 j, Récupéré par relances) ; graphique CA HT par jour (barres) vs période précédente (ligne) ; CA par nature (MO/Pièces/Sous-traitance/Frais) ; marge globale % ; panier moyen ; taux d'acceptation devis ; top 5 impayés ; alertes ; phrase M17 |
| Atelier | MANAGER | Compteurs OR par statut ; OR en retard ; occupation réelle/planifiée (jauge) ; tableau mécaniciens (heures présence, pointées, vendues, efficacité, productivité) ; OR `WAITING_PARTS` > 48 h |
| Accueil | ADVISOR | RDV du jour ; relances à valider ; devis en attente ; véhicules prêts ; messages non lus (M11) |
| Finances | ACCOUNTANT | Encaissements par mode (barres) ; encours + balance âgée (barres horizontales) ; DSO ; factures FNE en échec ; promesses du jour |
| Relances | OWNER, ADVISOR | Envoyés / délivrés / lus (30 j) ; clients revenus après rappel ; montant récupéré ; taux de retour VT / révision ; graphique envois par semaine empilés par type |
| Clients | OWNER | Actifs, nouveaux, perdus ; top pièces |

CASHIER : carte unique « Ma caisse du jour » (encaissements par mode de sa `CashSession` ouverte). MECHANIC : pas d'accès (redirigé vers `(tech)`).
Chaque carte : valeur, variation colorée **avec flèche et texte** (jamais la couleur seule), info-bulle « Comment est-ce calculé ? » reprenant la formule en langage simple, lien vers la liste détaillée. Mobile : cartes en grille 2×2, blocs empilés, graphiques simplifiés (7 points max). États : squelettes au chargement ; vide « Pas encore de données sur cette période » ; erreur « Impossible de charger les chiffres. Réessayer ». Badge « coût estimé » sur les marges quand RG-M12-08/09 utilisent un défaut.

**`/rapports`** — Grille des rapports (titre, description, dernier export). **`/rapports/[slug]`** : filtres, aperçu paginé (50 lignes), totaux, boutons « Excel » et « PDF ». Rapports :

| Slug | Rapport | Colonnes principales |
|---|---|---|
| `ventes` | Ventes | Date, n° facture, client, site, CA MO, pièces, sous-traitance, frais, remise, HT, TVA, TTC ; regroupement jour / mois / client / conseiller |
| `encaissements` | Encaissements par mode | Date, n° reçu, client, mode, référence, montant, caissier, factures allouées ; sous-totaux par mode et par jour |
| `balance-agee` | Balance âgée | Client, facture, émission, échéance, total, payé, solde, retard (j), tranche ; onglet synthèse par client |
| `rentabilite-or` | Rentabilité par OR | N° OR, client, véhicule, CA MO, coût MO, CA pièces, coût pièces, marge, marge %, heures vendues/pointées |
| `stock-valorise` | Stock valorisé | Site, SKU, désignation, catégorie, quantité, CMP, valeur (= `onHand × averageCost`) ; à une date passée : `onHand` reconstitué = actuel − Σ mouvements postérieurs, valorisé au CMP actuel (mention « valorisation au CMP actuel ») |
| `relances` | Performances des relances | Type, palier, canal, envoyés, délivrés, lus, réponses, RDV, payés, montant récupéré, coût messages |
| `productivite` | Productivité | Mécanicien, présence, pointé, vendu, efficacité, productivité, rendement, nb OR |
| `clients` | Clients actifs/perdus | Client, dernière activité, CA 12 mois, statut |
| `top-pieces` | Top pièces | cf. RG-M12-26 |

**`/rapports/comparaison-sites`** — tableau sites × indicateurs, ligne Réseau, tri par colonne, meilleur site en gras + icône, export Excel. Visible si ≥ 2 sites actifs.

**Exports** : Excel via `exceljs` (onglet « Données » + « Synthèse » + « Paramètres » rappelant période, site, date de génération, utilisateur) ; montants en nombres avec format `# ##0 "FCFA"` ; PDF via `@react-pdf/renderer` en A4 paysage avec en-tête garage (logo, nom, NCC). Nom de fichier : `{slug}_{from}_{to}_{site|reseau}.{xlsx|pdf}`.

## 8. API

| Procédure tRPC | Entrée | Sortie |
|---|---|---|
| `dashboard.get` | `{ tab, period: {preset} \| {from,to}, siteId? }` | `{ cards: Kpi[], blocks: Record<string, unknown>, computedAt, estimatedFlags[] }` |
| `dashboard.kpi` | `{ metric: KpiCode, period, siteId?, compare?: boolean }` | `{ value, previous?, deltaPct?, numerator?, denominator? }` (utilisé par M17) |
| `dashboard.refresh` | `{ siteId? }` | `{ ok }` (invalide le cache) |
| `reports.preview` | `{ slug, filters, cursor? }` | `{ rows, totals, nextCursor }` |
| `reports.export` | `{ slug, filters, format: 'xlsx'\|'pdf' }` | `{ exportId, status, url? }` (synchrone si ≤ 5 000 lignes) |
| `reports.getExport` | `{ exportId }` | `{ status, url?, error? }` |
| `reports.listExports` | `{ cursor? }` | exports des 7 derniers jours |
| `reports.compareSites` | `{ period, metrics[] }` | `{ sites: [{siteId, values}], network }` |
| `alerts.list` | `{ unreadOnly? }` | `Notification[]` |
| `alerts.markRead` | `{ ids[] }` | `{ count }` |
| `digest.preview` | `{ date? }` | `{ text, html }` |
| `digest.updateSettings` | `{ enabled, time, channel, recipients[] }` | settings |

REST publique (M13) : `GET /api/v1/reports/kpis?metric=revenue_ht&from=2026-10-01&to=2026-10-31&siteId=` (scope `reports:read`).
Toutes les procédures passent par `requirePermission` (§10) et `db.forTenant(ctx)` ; `siteId` hors `Membership.siteIds` → `FORBIDDEN` « Vous n'avez pas accès à ce site. »

## 9. Automatisations et événements

- Tâches : `reports.rollup` (01:30 locale, J−1 + dates « sales »), `reports.export` (file `reports`), `digest.owner` (07:30 locale, heure surchargée par `settings.digest.time`), `alerts.scan` (toutes les 15 min : `ro_late`, `ro_ready_not_delivered`, `fne_failed`, `channel_error`, `import_stale`, `receivable_45d`).
- Événements consommés : `invoice.issued/voided`, `payment.received` (invalidation cache + marquage de la date `KpiDaily` à recalculer), `repair_order.status_changed`, `stock.below_minimum`, `cash_session.closed` (M08), `promise.broken` (M09).
- Émis : `report.export_ready` (notification à l'auteur avec lien).

## 10. Permissions

Permissions du catalogue M01 §10.1 (aucune nouvelle permission créée) :

| Action | Permission | Rôles par défaut |
|---|---|---|
| Onglets Accueil / Atelier / Relances (chacun filtré par les permissions de lecture des modules : `appointment:read`, `repair_order:read`, `reminder:read`) | aucune permission propre | Tous sauf MECHANIC |
| Onglet Synthèse, cartes CA/Encaissé/Récupéré, résumé quotidien, comparaison multi-sites | `dashboard:owner` | OWNER |
| Rapports opérationnels (productivité, relances, top pièces sans marge, clients) | `report:read` | OWNER, MANAGER, ACCOUNTANT |
| Rapports financiers (ventes, encaissements, balance âgée, rentabilité par OR, stock valorisé), marges et coûts, onglet Finances | `report:financial` | OWNER, ACCOUNTANT |
| Configurer alertes et résumé quotidien | `settings:update` | OWNER |
| Carte « Ma caisse du jour » | `cash:operate` | CASHIER, MANAGER, OWNER |

Les marges ne sont jamais renvoyées par l'API à un membre sans `report:financial` (champs omis côté serveur, pas seulement masqués). Un membre restreint à des sites ne voit jamais de donnée d'autres sites, y compris dans la ligne « Réseau ». Tout export est journalisé (`AuditLog` action `report.export`).

**Découpage de livraison** (03-plan-construction) : partie 1 (étape 2.4) = onglets Relances et Finances (créances), version REMINDERS_ONLY, `digest.owner`, alertes système (`channel_error`, `sms_balance_low`, `import_stale`, `receivable_45d`, `promise_broken`) ; partie 2 (étape 6.1) = reste du module.

## 11. Cas limites et erreurs

- Facture émise le 31/10 à 23 h 30 (Abidjan) → comptée en octobre (conversion fuseau avant troncature).
- Avoir émis en novembre sur une facture d'octobre → réduit le CA de **novembre** (date d'émission de l'avoir), pas d'octobre.
- Paiement alloué à plusieurs factures de sites différents → chaque allocation est comptée sur le site de sa facture pour `recovered_by_reminders` ; l'encaissement reste sur `Payment.siteId`.
- Mécanicien sans `Attendance` → productivité « — » et info-bulle « Présence non pointée ».
- Site sans `openingHours` → occupation « — » et lien « Renseigner les horaires » (M15).
- Export > 100 000 lignes → refus « Réduisez la période (100 000 lignes max par export) ».
- Rollup en échec → le tableau de bord bascule sur le calcul direct (plus lent) et affiche « Chiffres en cours de mise à jour ».
- Organisation sans aucune facture (REMINDERS_ONLY sans import factures) → blocs créances masqués et invitation « Importer vos factures » (M13).

## 12. Tests

- **Unitaires `core/reports`** : chaque formule RG-M12-05 à 26 avec jeux de données chiffrés (ex. 3 factures 100 000 / 250 000 / 85 000 HT + avoir 35 000 → CA 400 000) ; `attributePayment` (fenêtre, dernier contact, lien de paiement, allocation multiple) ; tranches de balance âgée aux bornes (0, 30, 31, 90, 91 j) ; périodes et fuseau ; DSO avec CA nul.
- **Intégration** : cohérence `KpiDaily` sommé = calcul direct sur 60 jours de données seed ; RLS sur les vues (organisation B ne voit rien de A) ; restriction de site.
- **E2E Playwright** : gérant mobile (390 px) ouvre le tableau de bord, change la période sur « Mois précédent », touche « Créances » → liste filtrée ; comptable exporte la balance âgée Excel et vérifie les totaux du fichier.

## 13. Définition de « terminé »

- [ ] Toutes les formules dans `core/reports` avec tests, aucune formule dupliquée dans le front ou M17.
- [ ] Vues SQL + `KpiDaily` + rollup + invalidation de cache en place.
- [ ] 6 onglets selon rôles, version mobile, info-bulles de calcul.
- [ ] 9 rapports avec exports Excel et PDF identiques à l'écran.
- [ ] Comparaison multi-sites, alertes (12 codes), résumé quotidien conforme à RG-M12-30.
- [ ] Mode REMINDERS_ONLY couvert.
- [ ] Temps de réponse `dashboard.get` < 300 ms en cache, < 2 s sans cache sur 50 000 factures.

## 14. Évolutions du modèle de données

```prisma
model KpiDaily {                                   // agrégat journalier (numérateurs/dénominateurs)
  id             String   @id @default(cuid())
  organizationId String
  siteId         String?                           // null = non attribuable à un site
  date           DateTime @db.Date                 // jour local de l'organisation
  metrics        Json                              // { revenueHt, revenueTtc, laborHt, partsHt, partsCost, laborCost, invoiceCount, collectedByMethod:{WAVE:..}, quotesDecided, quotesAccepted, workedMinutes, soldMinutes, attendanceMinutes, recoveredByReminders, ... }
  computedAt     DateTime @default(now())
  @@unique([organizationId, siteId, date])        // migration SQL : index unique NULLS NOT DISTINCT (siteId null)
}

model ReportExport {
  id             String   @id @default(cuid())
  organizationId String
  reportSlug     String                            // ventes | encaissements | balance-agee | ...
  format         String                            // xlsx | pdf
  filters        Json
  status         ReportExportStatus @default(PENDING)
  fileUrl        String?
  rowCount       Int?
  error          String?
  expiresAt      DateTime?
  createdById    String
  createdAt      DateTime @default(now())
}
enum ReportExportStatus { PENDING RUNNING READY FAILED EXPIRED }

// Ajouts à Notification (alertes)
model Notification {
  // ... champs existants
  severity   String?                               // info | warning | critical
  dedupeKey  String?                               // "alert.cash_difference:cs_123:2026-10-18"
  @@unique([organizationId, membershipId, dedupeKey])
}
```
Les champs `origin` (Invoice, Payment, RepairOrder) sont définis dans M13 §14 ; le modèle `Holiday` dans M15 §14.
