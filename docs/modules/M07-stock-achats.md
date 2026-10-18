# M07 — Stock, pièces, fournisseurs, achats

> Priorité : P1 · Dépend de : M01, M04, M06 (demandes de pièces), M08 (coût des ventes), M11 (envoi des bons de commande), M15 · Rôles concernés : `STOREKEEPER`, `MANAGER`, `OWNER`, `ADVISOR`, `MECHANIC`, `ACCOUNTANT`

## 1. Objectif

Savoir à tout moment **quelles pièces le garage possède, où, et ce qu'elles valent**, pour éviter les ruptures qui immobilisent un véhicule, les pièces qui dorment sur les étagères et les sorties non tracées (vols, oublis de facturation). Le module couvre le catalogue, le stock multi-sites, les réservations pour un OR, les achats fournisseurs (commande envoyée par WhatsApp, réception partielle), l'inventaire et la valorisation au **coût moyen pondéré** (CMP), base de la marge pièces affichée dans M12.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `STOREKEEPER` | Sorties vers OR, demandes des mécaniciens, réceptions, commandes, transferts, inventaires | Continu |
| `ADVISOR` | Cherche une pièce et son prix pour un devis, voit la disponibilité, réserve | Plusieurs fois/heure |
| `MECHANIC` | Demande une pièce (M06), consulte la disponibilité, scanne un code-barres | Plusieurs fois/jour |
| `MANAGER` | Valide commandes et ajustements, suit ruptures | Quotidien |
| `OWNER` | Valorisation, pièces dormantes, marges, écarts d'inventaire | Hebdomadaire |
| `ACCOUNTANT` | Export valorisation et mouvements, coût des ventes | Mensuel |

## 3. User stories

**US-M07-01 — En tant que magasinier, je veux un catalogue de pièces complet afin de retrouver une pièce par n'importe quelle référence.**
- Quand je saisis « 04152-YZZA1 », « filtre huile corolla » ou scanne `4987654321098`, alors la recherche (pg_trgm sur `sku`, `name`, `oemReference`, `barcode`, `crossReferences`, `brand`) renvoie le produit en moins de 300 ms avec son disponible par site.
- Étant donné un SKU déjà existant, quand je crée un produit avec le même SKU, alors « Le SKU FH-TOY-001 existe déjà » s'affiche.
- Étant donné un code-barres déjà affecté à un autre produit, alors la création est bloquée avec le nom du produit en conflit.

**US-M07-02 — En tant que conseiller, je veux voir les pièces compatibles avec le véhicule afin de chiffrer juste.**
- Étant donné le véhicule Toyota Corolla 2016, quand j'ajoute une pièce à un devis ou un OR, alors les produits dont `compatibleWith` correspond (RG-M07-02) sont proposés en premier avec le badge « Compatible ».

**US-M07-03 — En tant que conseiller, je veux réserver les pièces d'un OR afin qu'elles ne soient pas vendues à quelqu'un d'autre.**
- Étant donné 4 plaquettes AV en stock dont 0 réservée, quand l'OR OR-YOP-2026-00042 passe `APPROVED` avec une ligne de 1 jeu, alors une `StockReservation` de 1 est créée et `reserved` passe à 1 ; le disponible affiché passe à 3.
- Étant donné un disponible de 0, alors la réservation est créée en `BACKORDERED`, l'OR affiche « Pièce manquante » et une suggestion de commande liée à l'OR est proposée.

**US-M07-04 — En tant que magasinier, je veux sortir les pièces vers un OR afin que le stock et le coût de l'OR soient à jour.**
- Quand je valide la sortie d'une réservation (ou d'une demande de pièce M06), alors un `StockMovement` `ISSUE_TO_RO` (quantité négative, `unitCost = averageCost` courant) est créé, `onHand` et `reserved` diminuent, la réservation passe `ISSUED`, la demande M06 passe `DELIVERED`.
- Étant donné une sortie sans réservation préalable (pièce ajoutée en cours de travaux), alors une ligne PART est ajoutée à l'OR (approbation M04/M05 si non prévue).

**US-M07-05 — En tant que magasinier, je veux enregistrer le retour d'une pièce non utilisée afin de la remettre en stock.**
- Quand je retourne 1 filtre de l'OR, alors un mouvement `RETURN_FROM_RO` (+1, `unitCost` = coût de la sortie d'origine) est créé et la quantité de la ligne d'OR est diminuée. Une pièce montée puis démontée peut être retournée en « non revendable » : elle va alors en ajustement de perte (RG-M07-12).

**US-M07-06 — En tant que magasinier, je veux des suggestions de réapprovisionnement afin de ne jamais tomber en rupture sur les pièces courantes.**
- Étant donné le filtre à huile Corolla avec mini 10 et disponible prévisionnel 6, quand j'ouvre `/achats/suggestions`, alors je vois la quantité suggérée (RG-M07-07) regroupée par fournisseur par défaut, et je crée les bons de commande en un clic.

**US-M07-07 — En tant que magasinier, je veux créer et envoyer un bon de commande au fournisseur par WhatsApp ou email.**
- Quand je clique « Envoyer » sur BC-YOP-2026-00008, alors le PDF est généré, envoyé via M11 au `whatsappPhone` (ou `email`) du fournisseur avec un message modèle (`purchase_order_sent`), et le statut passe `SENT` avec `orderedAt`.
- Étant donné un fournisseur sans WhatsApp ni email, alors l'option « Télécharger le PDF / partager via lien wa.me » est proposée.

**US-M07-08 — En tant que magasinier, je veux réceptionner partiellement une commande.**
- Étant donné une commande de 20 filtres et 10 jeux de plaquettes, quand je reçois 20 filtres et 6 plaquettes au prix de 3 800 FCFA le filtre (au lieu de 3 600 prévus), alors deux mouvements `PURCHASE_RECEIPT` sont créés, le CMP est recalculé (RG-M07-05), `receivedQty` est mis à jour, la commande passe `PARTIALLY_RECEIVED`, et l'écart de prix est signalé.
- Quand les 4 plaquettes restantes arrivent, la commande passe `RECEIVED`.
- Étant donné une réception liée à des réservations `BACKORDERED`, alors celles-ci passent `RESERVED` (premier arrivé, premier servi selon `createdAt`) et le conseiller de l'OR est notifié « Pièces arrivées pour 2547 GH 01 ».

**US-M07-09 — En tant que magasinier, je veux faire un inventaire afin de corriger les écarts.**
- Quand je crée un inventaire (complet, par catégorie ou par emplacement), alors les quantités théoriques sont figées au démarrage ; je compte avec le scanner sur mobile ; l'écran montre les écarts en quantité et en valeur (RG-M07-10).
- Quand le gérant valide, des mouvements `COUNT_CORRECTION` sont créés pour chaque écart et l'inventaire passe `VALIDATED`.

**US-M07-10 — En tant que magasinier, je veux transférer des pièces entre sites.**
- Quand j'envoie 5 batteries de YOP vers COC, alors `TRANSFER_OUT` (−5) est créé à YOP ; quand COC réceptionne 5, `TRANSFER_IN` (+5) est créé à COC ; le transfert passe `RECEIVED`. Une réception de 4 laisse un écart de 1 à justifier.

**US-M07-11 — En tant que conseiller, je veux enregistrer une pièce fournie par le client afin de facturer seulement la pose.**
- Quand j'ajoute « Amortisseur AV (fourni par le client) » avec `customerSupplied = true`, alors la ligne a un prix de 0, n'impacte pas le stock, et la mention « Pièce fournie par le client — non garantie par le garage » apparaît sur l'OR et la facture.

**US-M07-12 — En tant que conseiller, je veux être averti quand je vends une pièce sous le prix minimum.**
- Étant donné le prix mini 40 000 FCFA, quand je saisis 35 000 FCFA ou une remise qui ramène le net HT sous 40 000, alors un blocage « Prix sous le minimum autorisé (40 000 FCFA) » s'affiche ; avec la permission `price:below_min`, je peux forcer avec un motif (audit).
- Étant donné un net HT sous le CMP (vente à perte), alors l'alerte est rouge et le motif est obligatoire même pour le gérant.

**US-M07-13 — En tant que gérant, je veux connaître la valeur de mon stock et mes pièces dormantes.**
- Quand j'ouvre `/stock/valorisation`, alors je vois la valeur totale par site et par catégorie (RG-M07-09) et, dans l'onglet « Dormantes », les produits sans sortie depuis 180 jours (paramétrable) avec leur valeur immobilisée.

**US-M07-14 — En tant que magasinier, je veux scanner les codes-barres avec la caméra de la tablette ou du téléphone.**
- Quand j'appuie sur l'icône scanner, la caméra arrière s'ouvre, détecte EAN-13/EAN-8/Code 128/QR, émet un bip et une vibration, et ouvre le produit. Un code inconnu propose « Créer un produit avec ce code » ou « Associer à un produit existant ».

## 4. Règles métier

**RG-M07-01 — Unités et quantités.** `Product.unit` ∈ {`pièce`, `litre`, `kit`, `jeu`, `mètre`, `kg`}. Les quantités de stock (`StockLevel`, `StockMovement`, `PurchaseOrderLine`, `StockReservation`) sont des **entiers en unité de base** : `baseQty = displayQty × Product.quantityScale`. `quantityScale` vaut 1 par défaut et 10 pour les produits au litre ou au kg (précision 0,1 L). Exemple : huile 5W30, scale 10 ; 4,5 L sur un OR → mouvement de −45. Les prix (`salePrice`, `averageCost`, `purchasePrice`) restent **par unité d'affichage** (par litre). Les calculs passent par `core/inventory/units`.

**RG-M07-02 — Compatibilité.** `compatibleWith` contient des chaînes normalisées `"MARQUE|MODELE|ANNEE_DEBUT-ANNEE_FIN"` (ex. `"TOYOTA|COROLLA|2014-2019"`, `"TOYOTA|*|*"` pour universel marque). Correspondance si marque égale (insensible à la casse), modèle égal ou `*`, et `Vehicle.year` dans l'intervalle (année inconnue = correspond). M17 peut suggérer des compatibilités à partir de l'historique des OR, à valider.

**RG-M07-03 — Disponible.** `available = onHand − reserved` par site. Disponible prévisionnel = `available + Σ(quantity − receivedQty)` des lignes de commandes `SENT`/`PARTIALLY_RECEIVED` du site.

**RG-M07-04 — Réservation.** Créée quand une ligne PART/CONSUMABLE d'OR est `APPROVED` (ou à la main). Si `available ≥ q` → `RESERVED` et `reserved += q` ; sinon la partie disponible est réservée et le reste est `BACKORDERED` (deux réservations). Libérée (`RELEASED`, `reserved −= q`) si la ligne est refusée/annulée ou l'OR `CANCELLED`. Une réservation `RESERVED` de plus de 30 jours sur un OR non actif est signalée.

**RG-M07-05 — Coût moyen pondéré (CMP)**, global par organisation (`Product.averageCost`), recalculé à **chaque entrée positive** avec son coût : `PURCHASE_RECEIPT` (coût d'achat), `RETURN_FROM_RO` (coût de la sortie d'origine), `COUNT_CORRECTION`/`ADJUSTMENT`/`TRANSFER_IN` positifs (CMP courant, donc sans effet sauf si le stock était négatif) :

```
Q  = Σ onHand (tous sites, en unités d'affichage) avant l'entrée, Q⁺ = max(Q, 0)
C  = averageCost avant
q  = quantité entrée, c = coût unitaire d'entrée (HT, frais d'approche inclus si saisis)
CMP' = round_half_up( (Q⁺ × C + q × c) / (Q⁺ + q) )
```

Exemple : 12 filtres à 3 500 FCFA ; réception de 20 à 3 800 → (12 × 3 500 + 20 × 3 800) / 32 = 118 000 / 32 = 3 687,5 → **3 688 FCFA**. Puis sortie de 5 : CMP inchangé 3 688, valeur sortie 18 440. Si le stock était négatif (−2) au moment de la réception, Q⁺ = 0 → CMP' = c. Première réception (Q = 0) → CMP' = c. Les sorties, transferts et ajustements négatifs **ne modifient pas** le CMP. `purchasePrice` = dernier `c`. Les frais d'approche (transport, dédouanement) saisis à la réception sont répartis au prorata de la valeur des lignes, arrondi par ligne, le reste d'arrondi sur la dernière ligne.

**RG-M07-06 — Stock négatif.** Interdit par défaut (`settings.stock.allowNegative = false`) : une sortie supérieure à `onHand` est bloquée (« Stock insuffisant : 2 disponibles à YOP, 5 à COC »). Si autorisé, la sortie passe, `onHand` devient négatif, la ligne apparaît dans « À régulariser » et une alerte gérant est émise. La sortie est alors valorisée au CMP courant.

**RG-M07-07 — Réapprovisionnement.** Pour chaque produit `isStocked` et site : `min = StockLevel.minStock ?? Product.minStock`. Si `prévisionnel < min` : `suggested = max(reorderQty ?? 0, (StockLevel.maxStock ?? 2 × min) − prévisionnel)`, arrondi au multiple supérieur de `Product.packSize` (défaut 1). Exemple : min 10, max 30, prévisionnel 6, pack 12 → 30 − 6 = 24 → **24**. Les réservations `BACKORDERED` non couvertes s'ajoutent toujours. M17 peut proposer un min/max à partir de la consommation des 90 derniers jours.

**RG-M07-08 — Bon de commande.** Total = Σ `quantity × unitCost` (en unités d'affichage, entier). Numérotation `BC-{site}-{année}-{seq}` via `DocumentSequence` (`docType = "BC"`). Modifiable en `DRAFT` uniquement ; en `SENT`, on peut ajouter des lignes (version notée dans l'audit) mais pas réduire sous `receivedQty`.

**RG-M07-09 — Valorisation.** Valeur = Σ `onHand × averageCost` (unités d'affichage), négatifs comptés à 0 et listés à part. Valorisation à date passée = reconstruction depuis les mouvements (Σ `quantity` jusqu'à la date × CMP à la date, historisé dans `StockMovement.costAfter`).

**RG-M07-10 — Inventaire.** Au démarrage, `expectedQty` = `onHand` figé par ligne. Écart = `countedQty − expectedQty` ; valeur d'écart = écart × CMP. Les mouvements survenus pendant le comptage (sorties vers OR) sont ajoutés à `expectedQty` de la ligne si elle n'est pas encore comptée, sinon signalés « mouvement après comptage ». Écart valorisé > `settings.stock.countApprovalThreshold` (défaut 50 000 FCFA) → validation `OWNER` obligatoire.

**RG-M07-11 — Pièces dormantes.** Produit dont le dernier mouvement de sortie (`ISSUE_TO_RO`, `TRANSFER_OUT`, `SUPPLIER_RETURN`) date de plus de N jours (défaut 180) et `onHand > 0`. Tranches 180–365 j, > 365 j.

**RG-M07-12 — Ajustement manuel** (`ADJUSTMENT`) : motif obligatoire parmi `casse`, `perte`, `vol`, `péremption`, `démontée non revendable`, `erreur de saisie`, `autre` + texte ; permission `stock:adjust` ; `AuditLog`. Valorisé au CMP.

**RG-M07-13 — Prix de vente.** `salePrice` HT conseillé ; marge = `(salePrice − averageCost) / salePrice`. Contrôle sur toute ligne PART/CONSUMABLE (devis, OR, facture) : net HT unitaire = `unitPrice × (100 − discountRate) / 100`. Si net < `minSalePrice` → blocage (dérogation `price:below_min` + motif). Si net < `averageCost` → alerte « vente à perte », motif obligatoire, événement `stock.sold_below_cost` (M12). Exemple : CMP 37 000, mini 40 000, prix 42 000 avec remise 10 % → net 37 800 → sous le mini → blocage.

**RG-M07-14 — Pièce fournie par le client.** `RepairOrderLine.customerSupplied = true` : `productId` facultatif, `unitPrice = 0`, aucun mouvement de stock ni réservation. Paramètre facultatif `settings.stock.customerPartFee` (forfait de prise en charge, ligne FEE).

**RG-M07-15 — Transferts.** Le CMP étant global, un transfert ne modifie pas la valeur totale. `TRANSFER_OUT` à l'envoi, `TRANSFER_IN` à la réception (au CMP courant). Écart à la réception → ajustement `perte` à justifier sur le site d'envoi.

**RG-M07-16 — Retour fournisseur.** Mouvement `SUPPLIER_RETURN` (négatif) au coût d'achat de la réception d'origine si connue, sinon CMP ; ne modifie pas le CMP. Génère un « avoir fournisseur attendu » (note sur la commande).

**RG-M07-17 — Intégrité.** `StockLevel.onHand` n'est modifié **que** dans la même transaction qu'un `StockMovement` (fonction unique `applyMovement`), avec verrou `SELECT … FOR UPDATE` sur la ligne `StockLevel` et le `Product` (CMP). Contrôle nocturne : `onHand = Σ quantity` ; écart → alerte technique.

## 5. Machines à états

**`PurchaseOrderStatus`**

| De | Vers | Qui | Effet |
|---|---|---|---|
| `DRAFT` | `SENT` | STOREKEEPER, MANAGER | `orderedAt`, envoi M11, événement `purchase_order.sent` |
| `SENT` | `PARTIALLY_RECEIVED` | STOREKEEPER | mouvements, CMP |
| `SENT`/`PARTIALLY_RECEIVED` | `RECEIVED` | STOREKEEPER (auto si toutes lignes reçues, ou « solder » avec motif) | `receivedAt` |
| `DRAFT`/`SENT` | `CANCELLED` | MANAGER (motif) | libère les liens réservations |
| `PARTIALLY_RECEIVED` | `CANCELLED` | interdit → utiliser « solder le reliquat » |

**`StockReservationStatus`** : `RESERVED → ISSUED` ; `BACKORDERED → RESERVED` (réception) ; `RESERVED/BACKORDERED → RELEASED`.

**`StockCountStatus`** : `DRAFT → IN_PROGRESS` (figer théorique) `→ SUBMITTED → VALIDATED` (mouvements) ; `IN_PROGRESS/SUBMITTED → CANCELLED`.

**`StockTransferStatus`** : `DRAFT → IN_TRANSIT` (TRANSFER_OUT) `→ RECEIVED` ; `DRAFT → CANCELLED`.

## 6. Données

Entités de 02 : `Product`, `StockLevel`, `StockMovement`, `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `RepairOrderLine` (PART/CONSUMABLE), `Site`, `DocumentSequence`, `Attachment`, `AuditLog`, `DomainEvent`, `Notification`, `PartRequest` (§14 de M06).

Ajouts (§14) : `Product.quantityScale/packSize/crossReferences/lastIssuedAt`, `StockLevel.minStock/maxStock`, `StockMovement` (`costAfter`, `transferId`, `countId`, `reservationId`, `repairOrderLineId`), `StockReservation`, `StockCount`/`StockCountLine`, `StockTransfer`/`StockTransferLine`, `PurchaseOrderLine.receivedCost`, `RepairOrderLine.customerSupplied`.

## 7. Écrans et interface

| Route | Contenu | Actions | Mobile |
|---|---|---|---|
| `/stock` | Tableau produits : SKU, nom, marque, réf OEM, catégorie, disponible par site, CMP, prix, alerte mini (icône + texte) | Recherche, scan, filtres (catégorie, sous le mini, négatif, inactif, site), créer, import CSV (M13) | Liste + scan plein écran |
| `/stock/[id]` | Fiche : références, compatibilités, prix et marge, niveaux par site + emplacement, réservations, historique des mouvements, fournisseurs et derniers prix | Modifier, ajuster (motif), imprimer étiquette code-barres | Onglets |
| `/stock/sorties` | File du magasin : réservations à sortir + `PartRequest` (M06) triées par urgence | Préparer, sortir, rejeter (motif), commander | Optimisé tablette |
| `/stock/mouvements` | Journal filtrable (type, produit, OR, date, utilisateur) | Export CSV | Lecture |
| `/stock/inventaires`, `/stock/inventaires/[id]` | Liste ; écran de comptage (scan → quantité), écarts en quantité et valeur | Démarrer, compter, soumettre, valider | Comptage pensé téléphone |
| `/stock/transferts` | Transferts par statut | Créer, expédier, réceptionner | Liste |
| `/stock/valorisation` | Valeur par site/catégorie, à date ; onglets « Dormantes », « Négatifs », « Ventes sous coût » | Export CSV/PDF | Cartes |
| `/achats` | Bons de commande par statut, fournisseur, retards (`expectedAt` dépassée) | Créer, envoyer, réceptionner | Liste |
| `/achats/[id]` | Lignes, quantités reçues, écarts de prix, pièces jointes (bon de livraison, facture fournisseur) | Envoyer WhatsApp/email, réceptionner (saisie ou scan), solder, annuler | Réception sur téléphone |
| `/achats/suggestions` | Suggestions groupées par fournisseur | Ajuster quantités, créer BC | Liste |
| `/achats/fournisseurs`, `/achats/fournisseurs/[id]` | Coordonnées (+225), délai, conditions, historique d'achats, produits | CRUD | Liste |

Scanner : composant partagé `BarcodeScanner` (`packages/ui`) utilisant l'API `BarcodeDetector` si disponible, sinon `@zxing/browser` ; gère aussi les douchettes USB (saisie clavier rapide terminée par Entrée, détectée par délai < 50 ms entre touches). Permission caméra refusée → « Autorisez la caméra dans les réglages du navigateur, ou saisissez le code ».

## 8. API (tRPC)

| Procédure | Entrée | Sortie |
|---|---|---|
| `product.search` | `{ q?, barcode?, vehicleId?, siteId?, category?, cursor }` | page `{ product, available[siteId], compatible: boolean }` |
| `product.get` / `.create` / `.update` / `.archive` | id / `ProductInput` | `Product` |
| `product.checkPrice` | `{ productId, unitPrice, discountRate }` | `{ ok, belowMin, belowCost, minSalePrice, averageCost }` |
| `stock.levels` | `{ productId }` | `StockLevel[]` |
| `stock.reserve` / `.release` | `{ repairOrderLineId, siteId, quantity }` / `{ reservationId, reason }` | `StockReservation[]` |
| `stock.issue` | `{ reservationId? , partRequestId?, repairOrderId, productId, siteId, quantity }` | `{ movement, line }` |
| `stock.returnFromRo` | `{ repairOrderLineId, quantity, resellable: boolean, reason? }` | `{ movement }` |
| `stock.adjust` | `{ siteId, productId, quantity (±), reasonCode, reason }` | `{ movement }` |
| `stock.movements` | filtres + curseur | page de `StockMovement` |
| `stock.valuation` | `{ siteId?, at?: date, groupBy: 'category'\|'site' }` | `{ total, groups[], negatives[] }` |
| `stock.dormant` | `{ days, siteId? }` | `[{ product, onHand, value, lastIssuedAt }]` |
| `stock.queue` | `{ siteId }` | réservations à sortir + `PartRequest` ouvertes |
| `partRequest.update` | `{ id, status, rejectReason? }` | `PartRequest` |
| `count.create` / `.start` / `.setLine` / `.submit` / `.validate` | `{ siteId, scope }` / `{ id }` / `{ lineId, countedQty }` / … | `StockCount` |
| `transfer.create` / `.ship` / `.receive` | `{ fromSiteId, toSiteId, lines }` / `{ id }` / `{ id, lines: [{ lineId, receivedQty }] }` | `StockTransfer` |
| `supplier.list` / `.create` / `.update` | | `Supplier` |
| `purchaseOrder.create` / `.update` / `.send` / `.cancel` | `{ supplierId, siteId, lines, repairOrderId? }` / … / `{ id, channel: 'WHATSAPP'\|'EMAIL'\|'LINK' }` | `PurchaseOrder` |
| `purchaseOrder.receive` | `{ id, lines: [{ lineId, quantity, unitCost }], landedCosts?: number, attachments? }` | `{ purchaseOrder, movements, priceVariances[] }` |
| `purchaseOrder.suggestions` | `{ siteId }` | `[{ supplierId, lines: [{ productId, suggestedQty, reason }] }]` |

REST public (M13) : `GET /api/v1/products`, `GET /api/v1/stock-levels`, `POST /api/v1/products` (import), scopes `stock:read`, `stock:write`.

## 9. Automatisations et événements

| Événement | Émis | Consommé par |
|---|---|---|
| `stock.below_minimum` | après un mouvement faisant passer le prévisionnel sous le mini (une fois par produit/site jusqu'à remontée) | M12 (alerte), suggestions |
| `stock.received` | réception d'achat ou de transfert | M06 (tablette), M04 (OR `WAITING_PARTS` → statut précédent si toutes pièces réservées), Notification conseiller |
| `stock.sold_below_cost` | RG-M07-13 | M12 |
| `stock.negative` | RG-M07-06 | Notification OWNER |
| `purchase_order.sent` | envoi | M11 (message au fournisseur) |

Consommés : `repair_order.status_changed` (`APPROVED` → réserver ; `CANCELLED` → libérer), `quote.accepted` (lignes acceptées → réservations), `part_request.created` (file magasin), `invoice.issued` (M08 : contrôle que toute ligne PART facturée a eu sa sortie ; sinon sortie automatique au CMP avec `reason = "auto à la facturation"`, paramétrable).

Worker : `stock.reorder_suggestions` (03:00) ; `stock.integrity_check` (03:30, RG-M07-17) ; `purchase.late_alerts` (08:00 : commandes `SENT` dont `expectedAt` est dépassée → notification magasinier, proposition de relance WhatsApp au fournisseur).

IA (M17) : extraction des lignes d'une facture/BL fournisseur photographié pour préremplir la réception ; suggestions min/max ; détection d'anomalies (sorties inhabituelles, écarts répétés sur un même produit).

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Consulter catalogue/stock | `stock:view` | Tous sauf CASHIER (lecture prix seulement) |
| Voir CMP et marges | `stock:cost` | OWNER, MANAGER, STOREKEEPER, ACCOUNTANT |
| Créer/modifier produit | `product:edit` | OWNER, MANAGER, STOREKEEPER |
| Réserver/libérer | `stock:reserve` | ADVISOR, STOREKEEPER, MANAGER |
| Sortir/retourner vers OR | `stock:issue` | STOREKEEPER, MANAGER |
| Ajuster | `stock:adjust` | OWNER, MANAGER |
| Inventaire (compter) / valider | `stock:count` / `stock:count_validate` | STOREKEEPER / OWNER, MANAGER |
| Transferts | `stock:transfer` | STOREKEEPER, MANAGER |
| Créer/envoyer BC | `purchase:create` / `purchase:send` | STOREKEEPER / MANAGER, STOREKEEPER |
| Réceptionner | `purchase:receive` | STOREKEEPER |
| Fournisseurs | `supplier:edit` | OWNER, MANAGER, STOREKEEPER |
| Vendre sous le prix mini | `price:below_min` | OWNER, MANAGER |
| Valorisation | `stock:valuation` | OWNER, ACCOUNTANT, MANAGER |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Deux conseillers réservent la dernière batterie en même temps | Verrou ligne `StockLevel` ; le second obtient `BACKORDERED` et « La dernière unité vient d'être réservée sur OR-YOP-2026-00041 » |
| Pièce vendue sous le coût (CMP 37 000, vendue 35 000) | Alerte rouge, motif obligatoire, événement M12 |
| Réception à un prix aberrant (×10 du dernier prix) | Confirmation « Prix 38 000 au lieu de 3 800 habituel : confirmer ? » avant recalcul du CMP |
| Stock négatif autorisé, réception ensuite | CMP' = coût d'entrée (Q⁺ = 0) ; ligne retirée de « À régulariser » quand onHand ≥ 0 |
| Erreur de réception déjà validée | Pas de suppression : mouvement inverse `ADJUSTMENT` motif « erreur de saisie » ; le CMP n'est pas recalculé à rebours (écart signalé à la comptabilité) |
| Fût d'huile 208 L entamé | Unité litre, scale 10 ; sorties de 4,5 L = 45 ; achat d'un fût = 2 080 en base |
| Code-barres partagé par deux marques | Unicité par organisation ; le second produit utilise `crossReferences` |
| Fournisseur envoie une pièce non commandée | Réception « hors commande » : ajout d'une ligne au BC en `SENT` avec audit |
| Produit archivé avec stock | Archivage refusé si `onHand ≠ 0` ou réservations ouvertes |
| Inventaire avec mouvements pendant le comptage | RG-M07-10 |
| Pièce fournie par le client défectueuse | Mention sur facture ; aucune garantie pièce |
| OR annulé après sortie de pièces | Proposition de retour au stock (`RETURN_FROM_RO`) ligne par ligne |
| Envoi WhatsApp du BC échoue | Le BC reste `DRAFT` avec le message d'erreur M11 ; bouton « Partager via wa.me » ou « Marquer comme envoyé » (envoi manuel) |

## 12. Tests

Unitaires (`packages/core/inventory`) :
- `computeWeightedAverageCost` : exemple 3 500/3 800 → 3 688 ; Q = 0 ; Q négatif ; arrondi demi-supérieur ; grandes quantités sans dépassement.
- `toBaseQty` / `fromBaseQty` : 4,5 L ↔ 45 ; refus de 4,55 L (précision).
- `suggestReorder` : exemple RG-M07-07 (24), pack, backorders, maxStock absent.
- `allocateLandedCosts` : 10 000 FCFA sur 3 lignes, reste d'arrondi.
- `checkSalePrice` : sous mini, sous coût, remise.
- `matchCompatibility` : jokers, année inconnue, casse.
- `computeCountVariance` : valeur d'écart, mouvements pendant comptage.

Intégration : réservations concurrentes (deux transactions), `purchaseOrder.receive` partiel puis total (statuts, CMP, backorders), `applyMovement` refuse un stock négatif, intégrité `onHand = Σ mouvements`, isolation multi-locataire.

E2E Playwright : « Réception d'une commande partielle (20 filtres à 3 800) → CMP 3 688 affiché → réservation pour OR 2547 GH 01 → sortie depuis la file magasin → stock et historique corrects → inventaire avec un écart de −1 validé ».

## 13. Définition de « terminé »

- [ ] Catalogue, recherche floue, compatibilités, scanner caméra + douchette.
- [ ] Stock multi-sites, réservations, sorties, retours, unités fractionnaires.
- [ ] CMP conforme à RG-M07-05 avec tests ; valorisation à date.
- [ ] Achats : suggestions, BC, envoi WhatsApp/email, réception partielle, frais d'approche, retours fournisseur.
- [ ] Inventaires et transferts complets.
- [ ] Contrôles de prix mini/coût sur devis, OR, factures.
- [ ] Événements émis/consommés, tâches worker, audit des ajustements.
- [ ] Tests unitaires/intégration/E2E verts ; libellés `fr.json`.

## 14. Évolutions du modèle de données

```prisma
model Product {
  // … champs existants
  quantityScale   Int      @default(1)    // 10 pour litre/kg : quantités de stock en dixièmes
  packSize        Int      @default(1)    // conditionnement d'achat (en unités d'affichage)
  crossReferences String[]                // références équivalentes / anciennes
  lastIssuedAt    DateTime?               // dénormalisé pour les dormantes
  @@index([organizationId, barcode])
}

model StockLevel {
  // … champs existants
  minStock        Int?                    // surcharge par site
  maxStock        Int?
}

model StockMovement {
  // … champs existants
  costAfter         Int?                  // CMP après le mouvement (historique de valorisation)
  repairOrderLineId String?
  reservationId     String?
  transferId        String?
  countId           String?
  reasonCode        String?               // casse | perte | vol | peremption | demonte | erreur | autre
  @@index([organizationId, productId, createdAt])
}

model StockReservation {
  id                String   @id @default(cuid())
  organizationId    String
  siteId            String
  productId         String
  repairOrderId     String
  repairOrderLineId String?
  quantity          Int                   // unités de base
  status            StockReservationStatus @default(RESERVED)
  purchaseOrderId   String?               // commande attendue si BACKORDERED
  createdById       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([organizationId, siteId, productId, status])
}
enum StockReservationStatus { RESERVED BACKORDERED ISSUED RELEASED }

model StockCount {
  id             String   @id @default(cuid())
  organizationId String
  siteId         String
  number         String                   // INV-YOP-2026-0003
  scope          Json     @default("{}")  // { categories?: [], bins?: [] } ; vide = complet
  status         StockCountStatus @default(DRAFT)
  startedAt      DateTime?
  validatedAt    DateTime?
  validatedById  String?
  varianceValue  Int      @default(0)
  lines          StockCountLine[]
}
enum StockCountStatus { DRAFT IN_PROGRESS SUBMITTED VALIDATED CANCELLED }

model StockCountLine {
  id           String  @id @default(cuid())
  stockCountId String
  productId    String
  expectedQty  Int
  countedQty   Int?
  unitCost     Int                        // CMP au démarrage
  countedById  String?
  countedAt    DateTime?
}

model StockTransfer {
  id             String   @id @default(cuid())
  organizationId String
  number         String                   // TR-2026-0012
  fromSiteId     String
  toSiteId       String
  status         StockTransferStatus @default(DRAFT)
  shippedAt      DateTime?
  receivedAt     DateTime?
  createdById    String?
  lines          StockTransferLine[]
}
enum StockTransferStatus { DRAFT IN_TRANSIT RECEIVED CANCELLED }

model StockTransferLine {
  id              String @id @default(cuid())
  stockTransferId String
  productId       String
  quantity        Int
  receivedQty     Int    @default(0)
}

model PurchaseOrderLine {
  // … champs existants
  receivedCost    Int?                    // dernier coût réel reçu (écart de prix)
}

model RepairOrderLine {
  // … champs existants
  customerSupplied Boolean @default(false)
}
```

`DocumentSequence.docType` accepte aussi `INV` et `TR`. Paramètres `Organization.settings.stock` : `allowNegative`, `dormantDays`, `countApprovalThreshold`, `autoIssueOnInvoice`, `customerPartFee`.
