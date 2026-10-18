# M04 — Réception et ordres de réparation (OR)

> Priorité : **P0** · Dépend de : M01, M02 · Interagit avec : M03 (RDV → réception), M05 (devis, approbation des travaux), M06 (affectation, pointage, inspection côté mécanicien), M07 (réservation/sortie de pièces), M08 (facturation, encaissement), M10/M11 (véhicule prêt, notifications), M14 (suivi client), M16 (sinistres), M17 (IA) · Rôles concernés : `ADVISOR`, `MANAGER`, `MECHANIC`, `STOREKEEPER`, `CASHIER`, `OWNER`

## 1. Objectif

L'OR est le dossier central de chaque passage d'un véhicule. Aujourd'hui, il est sur papier : l'état du véhicule à l'arrivée n'est pas prouvé (« la rayure était là avant ? »), les travaux supplémentaires sont accordés oralement puis contestés, le chef d'atelier ne sait pas où en est chaque voiture et le client appelle cinq fois pour savoir si c'est prêt. M04 numérise la **réception sur tablette** (kilométrage, carburant, photos, état des lieux sur schéma, objets laissés, doléances, signature), porte l'OR à travers une **machine à états** claire jusqu'à la restitution, structure les lignes de travail (MO, pièces, sous-traitance), intègre l'**inspection multipoints** qui alimente le devis, et gère contrôle qualité, restitution, garanties et retours.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Réception sur tablette, création de l'OR, saisie des doléances, suivi, communication client, restitution | 10 à 40 OR/jour |
| `MANAGER` | Affecte les tâches, suit le tableau de l'atelier, fait le contrôle qualité, décide des garanties, rouvre/annule | Continue |
| `MECHANIC` | Voit ses tâches, réalise l'inspection multipoints avec photos, ajoute un diagnostic, signale une pièce manquante, termine ses lignes (via PWA M06) | Continue |
| `STOREKEEPER` | Voit les pièces à préparer par OR, les sort du stock | Continue |
| `CASHIER` | Encaisse avant restitution | Quotidienne |
| `OWNER` | Consulte les OR bloqués, les retours, la rentabilité par OR | Quotidienne |
| `CUSTOMER` | Signe la réception, suit l'avancement via lien, reçoit « véhicule prêt » | Par visite |

## 3. User stories

**US-M04-01 — En tant que réceptionnaire, je veux faire la réception d'un véhicule sur tablette en moins de 5 minutes.**
- Étant donné l'écran `/ordres/reception` (ou « Client arrivé » depuis M03), quand je recherche « 2547 GH 01 », alors client et véhicule sont chargés avec leurs alertes (VT expire dans 15 j, révision due, solde impayé 185 000 FCFA, 2 absences, OR précédent sous garantie).
- Étant donné l'assistant de réception en 6 étapes (Véhicule → Compteur → État des lieux → Objets & accessoires → Doléances → Signature), quand je saisis 48 200 km, carburant 3/8, 6 photos, 2 dommages sur le schéma, « Bruit au freinage à l'avant + vidange », et que le client signe, alors un OR `CHECKED_IN` numéroté `OR-YOP-2026-00042` est créé, un `MileageReading` `RECEPTION` est enregistré (M02), le PDF « Bon de réception » est généré et envoyé au client par WhatsApp.
- Étant donné une coupure réseau pendant la réception, alors la saisie (photos comprises) est conservée localement (IndexedDB) et envoyée au retour du réseau, avec un bandeau « Réception enregistrée sur la tablette, envoi en attente ».

**US-M04-02 — En tant que réceptionnaire, je veux marquer les dommages existants sur un schéma de carrosserie afin de ne pas être accusé de les avoir causés.**
- Étant donné le schéma (vues dessus, avant, arrière, gauche, droite) adapté à la silhouette (berline, SUV/4x4, pick-up, citadine, utilitaire/minibus), quand je touche l'aile avant gauche et choisis « Rayure », gravité « Légère », et prends une photo, alors un repère numéroté apparaît sur le schéma et dans la liste « 1. Aile AVG — rayure légère (photo) ».
- Étant donné l'option « Aucun dommage constaté », alors elle doit être cochée explicitement si aucun repère n'est posé (pas de liste vide ambiguë).
- Étant donné le PDF de réception, alors le schéma avec repères et les miniatures des photos y figurent.

**US-M04-03 — En tant que réceptionnaire, je veux lister les objets et accessoires présents afin d'éviter les litiges de restitution.**
- Étant donné la liste à cocher (roue de secours, cric, clé de roue, triangle, gilet, extincteur, façade autoradio, tapis, enjoliveurs, antenne, carte grise, attestation d'assurance, vignette, nombre de clés), quand je coche et ajoute « Sac noir dans le coffre — client informé », alors ces éléments sont enregistrés dans `checkIn.items` et `checkIn.belongings`.
- Étant donné la restitution, alors la même liste est présentée pour contrôle contradictoire.

**US-M04-04 — En tant que client, je veux signer la réception sur la tablette ou à distance.**
- Étant donné la page de signature, alors je vois le récapitulatif (km, carburant, dommages, objets, doléances, mention « J'autorise le diagnostic ; aucun travail ne sera réalisé sans mon accord au-delà de 0 FCFA » avec le plafond d'autorisation saisi), j'écris mon nom et signe au doigt.
- Étant donné que le client a déposé la voiture et est parti (dépôt par un chauffeur, remise de clés en dehors des heures), alors « Faire signer à distance » envoie un lien `/p/[token]/reception` ; l'OR reste `CHECKED_IN` avec la mention « Signature en attente ».
- Étant donné un refus de signer, alors « Client refuse de signer » est enregistré avec le nom du réceptionnaire et l'heure (`checkIn.signatureRefused = true`).

**US-M04-05 — En tant que réceptionnaire, je veux fixer un plafond d'autorisation afin que l'atelier puisse avancer sans rappeler le client pour 10 000 FCFA.**
- Étant donné un plafond de 50 000 FCFA TTC saisi à la réception, quand le mécanicien ajoute des lignes dont le cumul approuvé reste ≤ 50 000 FCFA, alors ces lignes sont `APPROVED` automatiquement (`approvalSource = PRE_AUTHORIZED`).
- Étant donné un cumul qui dépasserait le plafond, alors les lignes passent `PENDING` et un devis complémentaire est requis (M05).

**US-M04-06 — En tant que mécanicien, je veux remplir l'inspection multipoints sur tablette afin que le client voie ce qui doit être fait.**
- Étant donné l'OR et le modèle « Inspection 30 points », quand j'ouvre l'inspection, alors les points sont groupés par catégorie (Freinage, Pneumatiques, Éclairage, Niveaux, Suspension/Direction, Moteur, Climatisation, Batterie/Électricité, Carrosserie/Vitrage, Échappement).
- Étant donné « Plaquettes avant » : URGENT, mesure « 2 mm », photo, alors l'item est enregistré avec des pièces/opérations recommandées pré-proposées (plaquettes AV + MO « Remplacement plaquettes AV » 1 h) que je peux modifier.
- Étant donné le bouton « Tout OK » sur une catégorie, alors tous ses points non renseignés passent `OK`.
- Étant donné la fin de l'inspection, alors elle est `completedAt`, l'OR passe de `DIAGNOSING` à `AWAITING_APPROVAL` si au moins un item `URGENT`/`WATCH` a des recommandations, et le réceptionnaire reçoit la notification « Inspection terminée — OR-YOP-2026-00042 : 1 urgent, 3 à surveiller ».

**US-M04-07 — En tant que réceptionnaire, je veux transformer l'inspection en devis en un clic.**
- Étant donné une inspection terminée, quand je clique « Créer le devis », alors M05 crée un devis dont chaque item `URGENT`/`WATCH` avec recommandations devient un groupe de lignes (`QuoteLine.priority` = résultat, URGENT non optionnel, WATCH `isOptional = true`), avec photos jointes ; les items passent `addedToQuote = true`.
- Étant donné l'acceptation partielle par le client (2 lignes sur 3), alors les lignes acceptées sont ajoutées à l'OR (`approval = APPROVED`, `quoteLineId`), les refusées sont conservées dans l'historique de l'OR comme « Refusées par le client » (et alimentent les relances futures « travaux recommandés non réalisés », M10).

**US-M04-08 — En tant que chef d'atelier, je veux voir tous les véhicules de l'atelier sur un tableau par statut.**
- Étant donné `/ordres` en vue Tableau (kanban), alors chaque colonne est un statut actif, chaque carte affiche : n° OR, plaque, modèle, client, mécanicien(s), promesse de restitution (rouge si dépassée), priorité, icônes (attente pièce, devis envoyé non lu, photo urgente).
- Étant donné le glisser d'une carte de `APPROVED` vers `IN_PROGRESS`, alors la transition est contrôlée par la machine à états (refus si interdite, avec motif).
- Étant donné le filtre « Mes OR » / mécanicien / priorité / « En retard », alors le tableau se met à jour.

**US-M04-09 — En tant que réceptionnaire, je veux ajouter des lignes MO, pièces, sous-traitance et frais à l'OR.**
- Étant donné l'ajout de « Vidange moteur + filtre » (catalogue MO, 0,5 h × 15 000 FCFA/h = 7 500 FCFA), « Huile 5W30 » 4 L × 4 500 FCFA = 18 000 FCFA, « Filtre à huile Toyota » 1 × 5 500 FCFA, alors l'OR affiche sous-total HT 31 000 FCFA, TVA 18 % 5 580 FCFA, total TTC 36 580 FCFA.
- Étant donné une pièce fournie par le client (« plaquettes achetées au marché d'Adjamé »), quand je coche « Fournie par le client », alors la ligne est `unitPrice = 0`, exclue de la garantie pièce, et la mention « Pièce fournie par le client — non garantie » est imprimée sur l'OR et la facture.
- Étant donné une ligne de sous-traitance « Rectification culasse — Atelier Tournage Adjamé », coût 60 000 FCFA, prix de vente 75 000 FCFA, alors le coût et le fournisseur sont stockés pour la marge, et le statut « Envoyé chez le sous-traitant le 20/10, retour prévu le 23/10 » est suivi.

**US-M04-10 — En tant que mécanicien, je veux signaler une pièce manquante afin que l'OR passe en attente et que le magasin commande.**
- Étant donné une pièce non disponible en stock (M07 : `onHand − reserved < quantité`), quand l'OR passe `APPROVED`, alors la ligne affiche « À commander » et le magasinier reçoit une notification ; si toutes les autres lignes sont terminées ou bloquées par cette pièce, le chef d'atelier passe l'OR en `WAITING_PARTS` (avec date de réception prévue issue du bon de commande, M07).
- Étant donné la réception de la pièce (`purchase.received` pour cet OR), alors une notification « Pièce reçue — OR-YOP-2026-00042 peut reprendre » est envoyée et l'OR revient `IN_PROGRESS` en un clic.

**US-M04-11 — En tant que chef d'atelier, je veux faire un contrôle qualité avant restitution.**
- Étant donné toutes les lignes approuvées `DONE`, quand le dernier mécanicien termine, alors l'OR passe `QUALITY_CHECK` (si `settings.repairOrders.qcRequired = true`, sinon directement `READY`).
- Étant donné la check-list de contrôle qualité (essai routier fait, niveaux vérifiés, serrage des roues au couple, absence de voyant, véhicule propre, objets du client présents, ancienne pièce remise si demandée), quand je valide, alors `qcById`, `qcAt` sont enregistrés et l'OR passe `READY`.
- Étant donné un défaut constaté, alors « Refuser » renvoie l'OR `IN_PROGRESS` avec le motif et la ligne concernée rouverte (`IN_PROGRESS`), et le mécanicien est notifié.

**US-M04-12 — En tant que client, je veux être prévenu dès que mon véhicule est prêt, avec le montant et un lien de paiement.**
- Étant donné l'OR passe `READY`, alors M10/M11 envoie : « Bonjour M. Kouassi, votre Toyota Corolla (2547 GH 01) est prête. Montant : 36 580 FCFA. Payer par Wave/Orange Money : {{lien.paiement}}. Nous sommes ouverts jusqu'à 18:00. » (lien de paiement créé par M08 sur la facture brouillon ou émise selon les paramètres).
- Étant donné un client qui n'est pas revenu 3 jours ouvrés après `READY`, alors un rappel automatique est envoyé, et après `settings.repairOrders.storageFeeAfterDays` (défaut 7) le réceptionnaire est invité à ajouter des frais de gardiennage (si activé, défaut 2 000 FCFA/jour).

**US-M04-13 — En tant que réceptionnaire, je veux restituer le véhicule en vérifiant le paiement et faire signer la restitution.**
- Étant donné un OR `READY` avec facture payée, quand je clique « Restituer », alors l'écran affiche la check-list des objets de la réception, le km de sortie, le carburant, les anciennes pièces remises (oui/non), la signature du client ; à la validation l'OR passe `DELIVERED` (puis `INVOICED` automatiquement si la facture est émise), `deliveredAt` est horodaté, le km de sortie crée un relevé.
- Étant donné un solde impayé et un client comptant (`paymentTermsDays = 0`), alors la restitution est bloquée : « Solde à régler : 36 580 FCFA. Encaissez ou demandez l'autorisation du gérant. » ; un utilisateur avec `repair_order:deliver_unpaid` peut forcer avec motif (audit), ce qui crée la créance (M09).
- Étant donné un client entreprise à 30 jours dont l'encours après cette facture reste sous le plafond, alors la restitution est autorisée sans paiement.
- Étant donné qu'un tiers récupère le véhicule (chauffeur), alors son nom et son téléphone sont saisis (`delivery.collectedBy`).

**US-M04-14 — En tant que client, je veux contester ou signaler un problème après réparation et que le garage le traite comme un retour.**
- Étant donné M. Koné revenu 10 jours après pour le même bruit de freinage, quand le réceptionnaire crée un OR et coche « Retour sur travaux » en sélectionnant l'OR d'origine (`OR-YOP-2026-00031`), alors l'OR est marqué `isComeback`, lié à l'original, et les lignes encore sous garantie de l'OR d'origine sont affichées.
- Étant donné la décision du chef d'atelier « Sous garantie », alors les lignes de l'OR de retour sont en `payer = WARRANTY` (non facturées au client, coût interne suivi) ; « Hors garantie » (cause différente, usure normale, pièce fournie par le client) → `payer = CUSTOMER` avec motif communiqué au client.
- Étant donné un retour, alors il compte dans l'indicateur « Taux de retour » (M12) par mécanicien et par opération.

**US-M04-15 — En tant que réceptionnaire, je veux imprimer ou envoyer les documents de l'OR.**
- Étant donné l'OR, alors je peux générer : Bon de réception (avec schéma, photos, signature), Fiche de travail atelier (sans prix, avec doléances, lignes, mécaniciens, cases de pointage), OR complet (avec prix estimés), Bon de restitution. Chaque PDF porte logo, coordonnées, RCCM/NCC, n° OR, QR code renvoyant au suivi (lien portail).

**US-M04-16 — En tant que client, je veux suivre l'avancement de ma réparation sans appeler.**
- Étant donné le lien reçu à la réception (`/p/[token]/suivi`), alors je vois une frise : Reçu → Diagnostic → En attente de votre accord → En réparation → Contrôle qualité → Prêt, avec l'heure de chaque étape, la promesse de restitution, les photos partagées et le bouton « Voir le devis » si un devis est en attente. Les notes internes et le nom des mécaniciens ne sont jamais affichés.

**US-M04-17 — En tant que chef d'atelier, je veux annuler un OR ou le rouvrir avec traçabilité.**
- Étant donné un OR sans travaux réalisés ni pièces sorties, « Annuler » (motif obligatoire : « Client a repris son véhicule sans travaux », « Doublon », « Devis refusé », autre) passe l'OR `CANCELLED` ; si un diagnostic a été facturé (frais de diagnostic), une facture reste possible.
- Étant donné un OR avec pièces sorties, alors l'annulation exige de les retourner en stock (M07 `RETURN_FROM_RO`) ou de les facturer.
- Étant donné un OR `DELIVERED` non facturé, « Rouvrir » le repasse `READY` avec motif (audit) ; un OR `INVOICED` ne se rouvre jamais (créer un OR de retour ou un avoir).

## 4. Règles métier

**RG-M04-01 — Numérotation.** `number = "OR-" + Site.code + "-" + année + "-" + séquence sur 5 chiffres` (ex. `OR-YOP-2026-00042`), séquence `DocumentSequence(organizationId, siteId, "OR", year)`, attribuée à la création (les trous sont tolérés pour les OR, contrairement aux factures).

**RG-M04-02 — Création.** Un OR exige `customerId`, `vehicleId`, `siteId`. Un brouillon (`DRAFT`) peut être créé sans réception (préparation à partir d'un RDV ou d'un devis). Un véhicule ne peut avoir qu'**un seul OR actif** (statut hors `DELIVERED`, `INVOICED`, `CANCELLED`) : « Ce véhicule a déjà un OR ouvert (OR-YOP-2026-00042). Ajoutez-y les travaux. » (forçable par `MANAGER`, ex. carrosserie et mécanique sur deux sites).

**RG-M04-03 — Réception obligatoire.** Passer `DRAFT → CHECKED_IN` exige : `mileageIn` (ou case « Compteur illisible/en panne » avec motif), `fuelLevel` (0-8), au moins 4 photos (avant, arrière, gauche, droite — paramétrable `settings.repairOrders.minCheckInPhotos`, 0 possible), le schéma renseigné (au moins un dommage ou « Aucun dommage constaté »), `complaint` non vide, et soit une signature, soit « Signature à distance en attente », soit « Refus de signer ». Le km de réception suit les contrôles M02 (RG-M02-09).

**RG-M04-04 — Structure `checkIn`** (JSON validé par Zod `CheckInSchema`) :
```ts
{
  bodyType: 'SEDAN' | 'SUV' | 'PICKUP' | 'HATCHBACK' | 'VAN' | 'MINIBUS' | 'TRUCK',
  noDamage: boolean,
  damages: { n: number, view: 'TOP'|'FRONT'|'REAR'|'LEFT'|'RIGHT', x: number, y: number, // 0-1 relatifs
             zone: string /* "Aile AVG" */, type: 'SCRATCH'|'DENT'|'CRACK'|'BROKEN'|'RUST'|'PAINT'|'MISSING'|'OTHER',
             severity: 'LIGHT'|'MEDIUM'|'HEAVY', note?: string, attachmentIds: string[] }[],
  items: { key: 'spare_wheel'|'jack'|'wheel_wrench'|'triangle'|'vest'|'extinguisher'|'radio_front'|'mats'|'hubcaps'|'antenna'|'registration_card'|'insurance_certificate'|'tax_sticker', present: boolean }[],
  keysCount: number,
  belongings: string,               // objets personnels signalés
  warningLights: string[],          // voyants allumés : 'engine','abs','airbag','oil','battery','temp','brake'
  tyresNote?: string,
  odometerUnreadable?: boolean,
  authorizationCeiling: number,     // plafond d'autorisation TTC en FCFA (0 = aucun)
  returnOldParts: boolean,          // le client veut récupérer les pièces remplacées
  dropOff: { by: 'OWNER'|'DRIVER'|'TOW'|'OTHER', name?: string, phone?: string },
  signatureRefused?: boolean, remoteSignaturePending?: boolean,
  checkOut?: { mileage: number, fuelLevel: number, itemsConfirmed: boolean, oldPartsReturned: boolean,
               collectedBy: { name: string, phone?: string }, signatureUrl?: string, at: string }
}
```
Photos et signatures : `Attachment` (`entity = "repair_order"`, `kind = photo_checkin | photo_damage | signature | photo_checkout | photo_work`), compressées côté client (max 1600 px, WebP), URL signées.

**RG-M04-05 — Calcul des montants d'une ligne** (`core/money/lines.ts`, partagé avec M05 et M08) :
```
gross     = round(quantity × unitPrice)
discount  = round(gross × discountRate / 100)
subtotal  = gross − discount                       (HT)
vat       = vatEnabled ? round(subtotal × vatRate / 100) : 0    (arrondi par ligne)
total     = subtotal + vat
```
Arrondi : demi-supérieur à l'unité FCFA. Totaux OR = somme des lignes **non annulées et non refusées** ; `RepairOrder.totalEstimate` = total TTC des lignes `APPROVED` ou `NOT_REQUIRED`, mis à jour en transaction à chaque modification de ligne. Exemple : 2,5 h × 15 000 = 37 500 HT ; remise 10 % = 3 750 → 33 750 HT ; TVA 18 % = 6 075 ; TTC 39 825 FCFA.

**RG-M04-06 — Prix des lignes.**
- MO : `unitPrice` = taux horaire selon `LaborOperation.rateType` (`settings.laborRates`, défaut STANDARD 15 000, DIAGNOSTIC 20 000, BODYWORK 15 000, ELECTRICAL 18 000 FCFA/h) ; si `fixedPrice` → `quantity = 1`, `unitPrice = fixedPrice` (forfait, ex. « Forfait vidange » 25 000 FCFA TTC pièces comprises → saisi comme FEE ou découpé selon paramètre).
- Pièce : `Product.salePrice` (ou tarif client `priceListId`), TVA `Product.vatRate`.
- Prix sous `Product.minSalePrice` : permission `invoice:price_below_min` + motif (audit).
- Remise de ligne : plafonds par rôle définis dans M05 (RG-M05-07), mêmes règles sur l'OR.
- Remise client par défaut (`Customer.discountRate`) appliquée automatiquement aux nouvelles lignes, modifiable.

**RG-M04-07 — Types de lignes.**
| `LineType` | Usage | Particularités |
|---|---|---|
| `LABOR` | Main-d'œuvre | `quantity` en heures (pas de 0,25), `assignedToId` (mécanicien), pointage M06 |
| `PART` | Pièce | `productId` (ou pièce hors catalogue : description libre, `isCustomerSupplied` possible), réservation et sortie M07 |
| `CONSUMABLE` | Ingrédients (graisse, nettoyant) | forfait ou % de la MO (`settings.consumablesRate`, défaut 0 = désactivé) |
| `SUBCONTRACT` | Travaux externes (tourneur, sellier, vitrier, recharge clim) | `supplierId`, `costPrice`, suivi envoi/retour |
| `FEE` | Frais (diagnostic, gardiennage, dépannage/remorquage, déplacement) | pas de stock |

**RG-M04-08 — Approbation des lignes** (`RepairOrderLine.approval`) :
- Lignes saisies à la réception à partir des doléances avec accord du client signé → `APPROVED`.
- Lignes ajoutées ensuite : `APPROVED` si cumul des lignes ajoutées après réception ≤ `authorizationCeiling` (`approvalSource = PRE_AUTHORIZED`), sinon `PENDING` → nécessite un devis (M05) ou un accord tracé (téléphone/en personne via `quote.recordDecision`).
- Lignes `payer = WARRANTY` ou `INTERNAL` → `NOT_REQUIRED`.
- Un mécanicien ne peut pas travailler sur une ligne `PENDING`/`DECLINED` (la PWA la montre grisée « En attente d'accord client »).

**RG-M04-09 — Pièces et stock (interface M07).** À l'approbation d'une ligne `PART` stockée : réservation (`StockLevel.reserved += qty`). À la sortie par le magasinier ou à la validation de la ligne : mouvement `ISSUE_TO_RO`. Annulation/refus d'une ligne : libération de la réservation ; si déjà sortie, retour `RETURN_FROM_RO` obligatoire ou maintien facturé. Pièce indisponible → suggestion de bon de commande lié à l'OR (`PurchaseOrder.repairOrderId`).

**RG-M04-10 — Promesse de restitution.** `promisedAt` saisi à la réception (proposition : aujourd'hui 17:00 si charge estimée ≤ 4 h et réception avant 11:00, sinon J+1 17:00 ; M17 peut affiner). Toute modification de `promisedAt` après la réception propose d'en informer le client (message « Nouveau délai : jeudi 22/10 à 16:00 — pièce en commande »). OR en retard = `now > promisedAt` et statut < `READY` → carte rouge, alerte au chef d'atelier.

**RG-M04-11 — Garantie sur travaux.**
- Par défaut (paramétrable `settings.warranty`) : MO 3 mois ou 5 000 km ; pièces fournies par le garage 6 mois ou 10 000 km (ou la garantie fabricant si renseignée sur le produit) ; pièces fournies par le client : 0 sur la pièce, MO garantie 1 mois uniquement sur le montage ; sous-traitance : selon le sous-traitant (champ libre).
- La garantie de chaque ligne est figée à la livraison : `warrantyUntilDate = deliveredAt + mois`, `warrantyUntilMileage = mileageIn + km`. « Premier atteint ».
- Un OR de retour (`comebackOfId`) affiche les lignes de l'OR d'origine encore sous garantie. La décision (`warrantyDecision`: `COVERED` | `NOT_COVERED` | `PARTIAL`) et son motif sont obligatoires avant de passer l'OR de retour en `APPROVED` ; permission `repair_order:warranty_decide`.
- Coût d'un retour couvert = MO pointée × `hourlyCost` du mécanicien + pièces au CMP, imputé au rapport « Coût des retours » (M12).

**RG-M04-12 — Retour (comeback).** Un OR est proposé comme retour si le même véhicule revient dans les 30 jours / 1 000 km suivant un OR livré et que les doléances partagent une catégorie d'opération (M17 propose : « Possible retour sur OR-YOP-2026-00031 (plaquettes AV, il y a 10 jours) ») ; le réceptionnaire confirme ou infirme.

**RG-M04-13 — Contrôle qualité.** Activé par défaut (`qcRequired = true`). Check-list configurable (`settings.repairOrders.qcChecklist`), chaque point `OK` / `NOK` / `N/A` ; un seul `NOK` interdit `READY`. Le contrôleur ne peut pas être le seul mécanicien ayant travaillé sur l'OR si l'atelier compte ≥ 2 personnes habilitées (avertissement, non bloquant).

**RG-M04-14 — Restitution et paiement.** Restituer exige un OR `READY` (ou `QUALITY_CHECK` forcé par `MANAGER` avec motif) et l'une des conditions :
1. Facture émise et soldée ;
2. Client à crédit (`paymentTermsDays > 0`) et encours + total ≤ `creditLimit` (ou `creditLimit` nul = illimité) ;
3. Total TTC payé par l'assurance et franchise réglée (M16) ;
4. Forçage `repair_order:deliver_unpaid` avec motif (crée/actualise la créance, alerte gérant).
Si `operatingMode = FULL`, la facture est générée (brouillon) automatiquement au passage `READY` (`settings.repairOrders.autoDraftInvoiceOnReady = true`) pour permettre le lien de paiement ; elle est émise (n° FNE) par le caissier.

**RG-M04-15 — Frais de gardiennage.** Si activés : à partir de `READY + storageFeeAfterDays` jours ouvrés, le système propose (jamais automatique) d'ajouter une ligne `FEE` « Frais de gardiennage du 30/10 au 05/11 (6 j × 2 000 FCFA) = 12 000 FCFA ». Le message « véhicule prêt » mentionne la politique si activée.

**RG-M04-16 — Modèles d'inspection.** `InspectionTemplate.items` = `[{ category, label, measurementUnit?, recommendedLaborCode?, recommendedProductCategory? }]`. Semence « Inspection 30 points » : Freinage (plaquettes AV/AR, disques AV/AR, liquide de frein, frein à main) ; Pneumatiques (usure AVG/AVD/ARG/ARD en mm, pression, roue de secours) ; Éclairage (feux de croisement, route, stop, clignotants, recul) ; Niveaux (huile moteur, liquide de refroidissement, lave-glace, direction assistée) ; Suspension/direction (amortisseurs AV/AR, rotules, silentblocs, cardans) ; Moteur (courroie accessoires, fuites, filtre à air) ; Climatisation (température de soufflage, filtre habitacle) ; Batterie (tension, cosses) ; Vitrage (pare-brise, essuie-glaces) ; Échappement. Modèles supplémentaires semés : « Pré-visite technique » (points contrôlés par les centres SICTA), « Inspection achat véhicule d'occasion ».
Le résultat global d'une catégorie = pire résultat de ses items (`URGENT` > `WATCH` > `OK`).

**RG-M04-17 — Inspection et devis.** Un item `URGENT`/`WATCH` sans recommandation est signalé (« 2 points à surveiller sans recommandation ») mais n'empêche pas la clôture. Le devis issu de l'inspection est créé par `quote.createFromInspection` (M05). Les items `WATCH` non acceptés alimentent `VehicleRecommendation` (§14) avec une date de rappel (défaut +90 jours) pour M10 (relance « travaux recommandés »).

**RG-M04-18 — Visibilité client.** Le client (portail, PDF) voit : statut public, doléances, constats d'inspection (libellés, résultats, photos marquées `shareWithCustomer = true` — par défaut toutes les photos d'inspection), lignes approuvées et prix. Jamais : notes internes, coûts, marges, nom des mécaniciens, pointages.

**RG-M04-19 — Libellés publics des statuts** (portail et messages) : `CHECKED_IN` « Reçu », `DIAGNOSING` « Diagnostic en cours », `AWAITING_APPROVAL` « En attente de votre accord », `APPROVED`/`IN_PROGRESS` « En réparation », `WAITING_PARTS` « En attente de pièces », `QUALITY_CHECK` « Contrôle final », `READY` « Prêt », `DELIVERED`/`INVOICED` « Restitué ».

## 5. Machine à états

```
DRAFT ─check_in─► CHECKED_IN ─start_diagnosis─► DIAGNOSING ─request_approval─► AWAITING_APPROVAL
  │                   │                              │                              │ (devis accepté/partiel,
  │                   └──approve (travaux connus)────┴──────────approve─────────────┤  accord tracé)
  │                                                                                  ▼
  │                                                                              APPROVED
  │                                                                                  │ start_work
  │                                                                                  ▼
  │                               ┌──────────────── resume ─────────────────── IN_PROGRESS ◄─┐
  │                               ▼                                                  │       │ qc_reject
  │                          WAITING_PARTS ──────────── wait_parts ◄─────────────────┤       │
  │                                                                                  │ complete_work
  │                                                                                  ▼       │
  │                                                                           QUALITY_CHECK ─┘
  │                                                                                  │ qc_pass
  │                                                                                  ▼
  │                                                                               READY ──deliver──► DELIVERED ──invoice_issued──► INVOICED
  │                                                                                  ▲                   │
  │                                                                                  └──── reopen ───────┘
  └──cancel──► CANCELLED  (depuis tout statut < READY, conditions RG-M04 US-17)
```

| Transition | De → Vers | Déclencheur / qui | Gardes | Effets de bord |
|---|---|---|---|---|
| `check_in` | DRAFT → CHECKED_IN | ADVISOR (`repair_order:create`) | RG-M04-03 | `MileageReading`, PDF réception, envoi lien de suivi, `appointment.markArrived` si lié |
| `start_diagnosis` | CHECKED_IN → DIAGNOSING | MANAGER/ADVISOR (affectation d'un mécanicien), ou auto quand un mécanicien démarre l'inspection ou pointe une ligne `DIAGNOSTIC` | — | `startedAt` si vide |
| `approve` (direct) | CHECKED_IN/DIAGNOSING → APPROVED | ADVISOR | ≥ 1 ligne `APPROVED`, aucune ligne `PENDING` bloquante | réservations stock |
| `request_approval` | DIAGNOSING → AWAITING_APPROVAL | auto à l'envoi d'un devis (`quote.sent` lié) ou manuel | ≥ 1 ligne `PENDING` | relance devis (M10) |
| `approve` | AWAITING_APPROVAL → APPROVED | auto sur `quote.accepted` / `quote.partially_accepted`, ou `quote.recordDecision` | ≥ 1 ligne acceptée | lignes approuvées ajoutées, réservations |
| `decline_all` | AWAITING_APPROVAL → READY | auto sur `quote.declined` si aucune ligne approuvée restante | — | seules les lignes déjà approuvées (ex. diagnostic) restent ; message « véhicule à récupérer » |
| `start_work` | APPROVED → IN_PROGRESS | auto au premier pointage MO (M06) ou manuel | — | `startedAt` |
| `wait_parts` | IN_PROGRESS/APPROVED → WAITING_PARTS | MANAGER/STOREKEEPER | ≥ 1 ligne PART non disponible | `waitingPartsSince`, message client optionnel (« pièce en commande, nouveau délai ») |
| `resume` | WAITING_PARTS → IN_PROGRESS | MANAGER, ou proposé à `purchase.received` | — | — |
| `complete_work` | IN_PROGRESS → QUALITY_CHECK (ou READY si QC désactivé) | auto quand toutes les lignes approuvées non annulées sont `DONE` ; ou manuel | aucune ligne approuvée `PENDING`/`IN_PROGRESS` ; aucun pointage ouvert | `completedAt` ; notification chef d'atelier |
| `qc_pass` | QUALITY_CHECK → READY | MANAGER (`repair_order:qc`) | check-list sans NOK | `qcById`, `qcAt` ; brouillon de facture ; **message véhicule prêt** (M10 `VEHICLE_READY`) |
| `qc_reject` | QUALITY_CHECK → IN_PROGRESS | MANAGER | motif + ligne(s) | ligne rouverte, notification mécanicien |
| `deliver` | READY → DELIVERED | ADVISOR/CASHIER (`repair_order:deliver`) | RG-M04-14 | `deliveredAt`, relevé km sortie, garanties figées, `vehicle.service_recorded` si révision, PDF restitution, message de remerciement + enquête (M10 `SATISFACTION`) |
| `invoice_issued` | DELIVERED → INVOICED | auto sur `invoice.issued` lié (ou immédiatement à la livraison si déjà émise) | facture couvrant l'OR émise | OR clôturé (lecture seule) |
| `reopen` | DELIVERED → READY | MANAGER (`repair_order:reopen`) | aucune facture émise | audit avec motif |
| `cancel` | tout < READY → CANCELLED | MANAGER (`repair_order:cancel`) | pas de pièces sorties non retournées, pas de pointage ouvert | réservations libérées ; `repair_order.cancelled` ; RDV lié inchangé |

Chaque transition émet `repair_order.status_changed { repairOrderId, from, to, at, byMembershipId }` et écrit `RepairOrderStatusHistory`. La fonction pure `core/repairOrders/stateMachine.ts#canTransition(order, lines, transition, ctx)` renvoie `{ ok } | { ok: false, code, message }`. `DELIVERED` et `INVOICED` rendent les lignes non modifiables (sauf ajout de notes et photos).

## 6. Données

Entités de `02` : `RepairOrder`, `RepairOrderLine`, `Inspection`, `InspectionItem`, `InspectionTemplate`, `LaborOperation`, `Attachment`, `TimeEntry` (lecture, M06), `MileageReading`, `Vehicle`, `Customer`, `Appointment`, `Quote`/`QuoteLine` (lien), `Product`/`StockLevel`/`StockMovement` (via M07), `Invoice` (lien), `Supplier`, `InsuranceClaim`, `DocumentSequence`, `AuditLog`, `Notification`.

Ajouts (§14) : `RepairOrder.bayId`, `publicToken`, `isComeback`, `comebackOfId`, `warrantyDecision`, `warrantyDecisionReason`, `waitingPartsSince`, `cancelReason`, `cancelledAt`, `qcChecklist`, `deliverySignatureUrl` ; `RepairOrderLine` : `isCustomerSupplied`, `costPrice`, `supplierId`, `subcontractStatus`, `approvalSource`, `warrantyMonths/Km/UntilDate/UntilMileage`, `inspectionItemId`, `completedAt`, `completedById` ; `InspectionItem.shareWithCustomer`, `sortOrder` ; `RepairOrderStatusHistory` ; `VehicleRecommendation`.

Paramètres `Organization.settings.repairOrders` : `minCheckInPhotos` (4), `qcRequired` (true), `qcChecklist` (liste), `autoDraftInvoiceOnReady` (true), `defaultAuthorizationCeiling` (0), `storageFeeEnabled` (false), `storageFeeAfterDays` (7), `storageFeePerDay` (2 000), `readyReminderAfterDays` (3) ; `settings.laborRates` ; `settings.warranty`.

## 7. Écrans et interface

| Route | Contenu | Actions | Tablette / mobile |
|---|---|---|---|
| `/(app)/ordres` | Vues **Tableau** (kanban par statut actif) et **Liste** (n°, date, plaque, client, statut, conseiller, mécaniciens, promesse, total estimé, flags). Compteurs en tête : « 14 à l'atelier · 3 en attente d'accord · 2 en attente de pièces · 4 prêts · 2 en retard ». | Filtres (statut, conseiller, mécanicien, priorité, en retard, retour, site), recherche, « Nouvelle réception » | Liste en cartes ; kanban avec défilement horizontal |
| `/(app)/ordres/reception` | **Assistant de réception** 6 étapes plein écran, gros boutons : (1) Véhicule & client (recherche plaque/téléphone, création rapide, alertes), (2) Compteur & carburant (pavé numérique, jauge carburant 8 crans tactile, voyants allumés en icônes), (3) État des lieux (photos guidées « Avant / Arrière / Gauche / Droite » avec cadre, schéma tactile, liste des dommages), (4) Objets & accessoires (cases, nb de clés, objets personnels, anciennes pièces à rendre ?), (5) Doléances & travaux (texte + dictée vocale du navigateur, opérations rapides : Vidange, Freins, Climatisation, Diagnostic, Pré-VT ; plafond d'autorisation ; promesse ; priorité), (6) Récapitulatif & signature (pad, nom du signataire, « Signature à distance », « Refus de signer ») | Suivant, Précédent, Enregistrer brouillon | Conçu tablette 10" paysage et portrait ; utilisable téléphone |
| `/(app)/ordres/[id]` | **En-tête** : n°, statut (badge), barre d'actions contextuelles selon la machine à états, client/véhicule (liens, appeler, WhatsApp), promesse (éditable), priorité, conseiller. **Onglets** : *Travaux* (lignes groupées par type ; colonnes description, mécanicien, qté, PU, remise, total, approbation (badge), statut ligne, payeur ; ajout rapide depuis catalogue MO/pièces avec recherche ; totaux HT/TVA/TTC ; part assurance/client si sinistre) · *Réception* (récap check-in, schéma, photos, signature) · *Inspection* (catégories, résultats colorés, photos, « Créer le devis ») · *Devis* (devis liés et état) · *Pièces* (réservées/sorties/à commander, liens BC) · *Temps* (pointages par ligne, temps barème vs réel — lecture M06) · *Documents* (PDF, photos, factures) · *Historique* (statuts, audit, messages envoyés) · *Notes internes* | Changer de statut, Affecter, Ajouter ligne, Envoyer le suivi, Créer devis, Imprimer, Restituer, Annuler, Rouvrir | Onglets défilants ; barre d'actions collée en bas |
| `/(app)/ordres/[id]/inspection` | Inspection en plein écran (aussi accessible depuis la PWA `(tech)` M06) : catégorie par catégorie, boutons OK / À surveiller / Urgent / Non vérifié de 56 px, mesure, commentaire, appareil photo, recommandations, « Tout OK » | Terminer l'inspection | Tablette d'abord |
| `/(app)/ordres/[id]/controle-qualite` | Check-list QC, essai routier (km départ/arrivée), commentaire | Valider (→ READY) / Refuser (motif, lignes) | Tablette |
| `/(app)/ordres/[id]/restitution` | Solde et état de la facture (bouton « Encaisser » → M08), objets de la réception à cocher, km et carburant de sortie, anciennes pièces remises, qui récupère, signature | Restituer | Tablette |
| `/(app)/parametres/ordres` | Plafond par défaut, photos minimales, QC et check-list, garanties, taux horaires, frais de gardiennage, consommables | Enregistrer | |
| `/(app)/parametres/inspection` | Modèles d'inspection : liste, éditeur (catégories, points, unité de mesure, recommandations par défaut), dupliquer | | |
| `/p/[token]/suivi` | Frise de statut publique, promesse, photos partagées, devis en attente, facture/paiement quand prêt, coordonnées | Voir le devis, Payer, Appeler | Mobile, < 150 Ko hors photos |
| `/p/[token]/reception` | Récap de réception + signature à distance | Signer | Mobile |

**Composants** (`packages/ui`) : `BodyDiagram` (SVG par silhouette, repères tactiles), `FuelGauge` (8 crans), `SignaturePad`, `PhotoCapture` (compression, file hors-ligne), `InspectionResultButton`, `RepairOrderStatusBadge`, `LineApprovalBadge`, `PromiseCountdown`.
**États** : liste vide → « Aucun véhicule à l'atelier. Commencez une réception. » ; envoi photo en échec → vignette avec icône de réessai ; transition refusée → toast avec le motif de la garde (« 2 lignes attendent l'accord du client »).

## 8. API

| Procédure | Entrée | Sortie |
|---|---|---|
| `repairOrder.list` | `{ siteId?, statuses?, advisorId?, mechanicId?, priority?, late?, comeback?, q?, cursor }` | page + compteurs par statut |
| `repairOrder.board` | `{ siteId }` | cartes groupées par statut actif |
| `repairOrder.get` | `{ id }` | OR + lignes + inspection(s) + devis liés + pièces + totaux + transitions autorisées pour l'utilisateur |
| `repairOrder.createDraft` | `{ siteId, customerId, vehicleId, appointmentId?, quoteId?, complaint? }` | OR `DRAFT` |
| `repairOrder.checkIn` | `{ id?, siteId, customerId, vehicleId, appointmentId?, mileageIn?, odometerUnreadable?, fuelLevel, checkIn: CheckInInput, complaint, promisedAt?, priority?, advisorId?, initialLines?: LineInput[], signature?: { dataUrl, signerName } \| { remote: true } \| { refused: true }, clientRequestId }` | OR `CHECKED_IN` (idempotent par `clientRequestId` pour la synchro hors-ligne) |
| `repairOrder.uploadAttachment` | `{ repairOrderId, kind, mime, size }` | `{ uploadUrl, attachmentId }` (URL signée PUT) |
| `repairOrder.update` | `{ id, promisedAt?, priority?, advisorId?, complaint?, diagnosis?, internalNotes?, bayId?, notifyCustomer? }` | OR |
| `repairOrder.transition` | `{ id, transition: 'start_diagnosis'\|'approve'\|'request_approval'\|'start_work'\|'wait_parts'\|'resume'\|'complete_work'\|'qc_pass'\|'qc_reject'\|'reopen'\|'cancel', reason?, data? }` | OR — erreur `TRANSITION_NOT_ALLOWED { code, message }` |
| `repairOrder.qc` | `{ id, checklist: { key, result }[], roadTest?: { kmStart, kmEnd }, comment?, rejectLineIds? }` | OR |
| `repairOrder.deliver` | `{ id, checkOut: CheckOutInput, signature?, forceUnpaidReason? }` | OR — erreurs `UNPAID_BALANCE { balance }`, `CREDIT_LIMIT_EXCEEDED { outstanding, limit }` |
| `repairOrder.setWarrantyDecision` | `{ id, decision, reason }` | OR |
| `repairOrder.markComeback` | `{ id, originalRepairOrderId }` | OR + lignes d'origine sous garantie |
| `repairOrder.pdf` | `{ id, kind: 'reception' \| 'workshop' \| 'full' \| 'delivery' }` | `{ url }` |
| `repairOrder.sendTrackingLink` | `{ id, channel? }` | `{ messageId }` |
| `repairOrderLine.add` | `{ repairOrderId, type, productId?, laborOperationId?, description, quantity, unitPrice?, discountRate?, vatRate?, assignedToId?, payer?, isCustomerSupplied?, supplierId?, costPrice? }` | ligne + totaux OR |
| `repairOrderLine.update` | `{ id, patch }` | ligne + totaux — erreur `LINE_LOCKED` si OR livré/facturé |
| `repairOrderLine.remove` | `{ id, reason? }` | totaux (suppression si `PENDING` jamais approuvée, sinon `CANCELLED`) |
| `repairOrderLine.setStatus` | `{ id, status }` | ligne (utilisé par M06) |
| `repairOrderLine.assign` | `{ id, membershipId }` | ligne |
| `repairOrderLine.setSubcontractStatus` | `{ id, status: 'TO_SEND'\|'SENT'\|'RETURNED', expectedAt? }` | ligne |
| `inspection.start` | `{ repairOrderId, templateId }` | inspection avec items |
| `inspection.saveItem` | `{ itemId, result, measurement?, comment?, photoAttachmentIds?, recommendedProductIds?, recommendedLaborIds?, shareWithCustomer? }` | item |
| `inspection.bulkOk` | `{ inspectionId, category }` | items |
| `inspection.complete` | `{ inspectionId }` | `{ inspection, summary: { urgent, watch, ok }, orStatus }` |
| `inspectionTemplate.list/create/update/archive` | `{ name, items[] }` | modèle |
| `portal.repairOrder.tracking` (public) | `{ token }` | vue publique (RG-M04-18/19) |
| `portal.repairOrder.signReception` (public) | `{ token, signatureDataUrl, signerName }` | `{ ok }` |

REST public (M13, scope `repair_orders:read`) : `GET /api/v1/repair-orders?status&updatedSince`, `GET /api/v1/repair-orders/{id}` (pour un logiciel tiers ou un gestionnaire de flotte).

## 9. Automatisations et événements

**Émis** : `repair_order.created`, `repair_order.status_changed`, `repair_order.line_added` (`{ approval }`), `repair_order.ready`, `repair_order.delivered`, `repair_order.cancelled`, `inspection.completed`, `vehicle.mileage_recorded` (à la réception et à la sortie).
| Consommateur | Usage |
|---|---|
| M03 | RDV → `COMPLETED` à la livraison |
| M05 | proposition de devis à `inspection.completed` ; devis complémentaire pour lignes `PENDING` |
| M06 | file de tâches des mécaniciens, pointage |
| M07 | réservation / libération / sortie de pièces, suggestion de commande |
| M08 | brouillon de facture à `READY`, lien de paiement |
| M10 | `VEHICLE_READY` (message immédiat + rappel J+3), `SATISFACTION` après livraison, relance « travaux recommandés » (`VehicleRecommendation`) |
| M11 | lien de suivi à la réception, messages de changement de délai |
| M12 | délais, retours, rentabilité OR, véhicules bloqués |

**Consommés** : `appointment.arrived` (ouvre la réception), `quote.accepted` / `quote.partially_accepted` / `quote.declined` (lignes et transition), `purchase.received` (notification reprise), `time_entry.started` (M06 → `start_work`), `invoice.issued` (→ `INVOICED`), `payment.received` (débloque la restitution, met à jour l'écran).

**Worker** : `repairOrders.late_check` (toutes les 15 min) — notifications OR en retard sur promesse ; `repairOrders.ready_followup` (quotidien 10:00) — véhicules prêts non récupérés, proposition de frais de gardiennage ; `repairOrders.reception_pdf` (file) — génération PDF et envoi.

**IA (M17)** : structuration des doléances dictées (« ça fait tac-tac quand je tourne » → catégorie « Transmission/cardans », opérations suggérées) ; suggestion de lignes et de durée à partir des doléances et de l'historique du modèle ; détection de dommages sur photos de réception (proposition de repères, à confirmer) ; détection des retours probables (RG-M04-12) ; résumé client en langage simple des constats d'inspection (« Vos plaquettes avant sont à 2 mm : il faut les changer rapidement pour freiner en sécurité ») ; prévision de `promisedAt`. Rien n'est appliqué sans validation.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir les OR | `repair_order:read` | OWNER, MANAGER, ADVISOR, MECHANIC (ses OR en `(tech)`), STOREKEEPER, CASHIER, ACCOUNTANT |
| Réception, créer, modifier lignes et infos | `repair_order:create` / `repair_order:update` | OWNER, MANAGER, ADVISOR |
| Affecter mécaniciens / pont | `repair_order:assign` | OWNER, MANAGER |
| Remplir l'inspection, terminer ses lignes, ajouter photos/diagnostic | `inspection:perform` (+ `time:clock`) | OWNER, MANAGER, ADVISOR, MECHANIC |
| Modèles d'inspection | `inspection:template_manage` | OWNER, MANAGER |
| Contrôle qualité | `repair_order:qc` | OWNER, MANAGER |
| Restituer (payé ou crédit valide) | `repair_order:deliver` | OWNER, MANAGER, ADVISOR, CASHIER |
| Restituer impayé (forçage) | `repair_order:deliver_unpaid` | OWNER |
| Annuler | `repair_order:cancel` | OWNER, MANAGER |
| Rouvrir | `repair_order:reopen` | OWNER, MANAGER |
| Décision de garantie | `repair_order:warranty_decide` | OWNER, MANAGER |
| Prix sous minimum | `invoice:price_below_min` | OWNER |
| Voir coûts et marges de l'OR | `product:view_cost` + `report:read` | OWNER, MANAGER |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Compteur en panne / tableau de bord éteint | « Compteur illisible » + motif ; pas de relevé km créé ; avertissement sur l'OR. |
| Véhicule amené par une dépanneuse, client absent | `dropOff.by = TOW` ; signature à distance ; doléances saisies d'après l'appel. |
| Chauffeur d'une flotte dépose le véhicule | Le chauffeur signe la réception (`signerName`) ; le devis part au responsable flotte (contact `receivesReminders`/`receivesInvoices`). |
| Client conteste une rayure à la restitution | Le bon de réception (schéma + photos horodatées + signature) est affiché ; si dommage nouveau, « Déclarer un incident » crée une note et une ligne `INTERNAL` éventuelle (réparation à la charge du garage). |
| Pièce fournie par le client défectueuse | Ligne `isCustomerSupplied` : non garantie ; la MO de remplacement supplémentaire est facturable ; le message au client le précise. |
| Client veut récupérer ses anciennes pièces | `returnOldParts = true` → rappel dans la check-list QC et la restitution ; les pièces sous échange standard (consigne) sont signalées non restituables. |
| Travaux supplémentaires découverts en cours de réparation | Ligne `PENDING` → OR reste `IN_PROGRESS` pour les autres lignes ; devis complémentaire envoyé ; si la ligne bloque tout, passage manuel en `AWAITING_APPROVAL` autorisé depuis `IN_PROGRESS` (`request_approval`). |
| Client injoignable pour un accord | L'OR reste `AWAITING_APPROVAL` ; M10 relance (devis) ; à J+3 alerte au réceptionnaire « Accord en attente depuis 3 jours ». |
| Prix d'une pièce change entre devis et facture | Le prix du devis accepté fait foi sur l'OR (`unitPrice` copié depuis `QuoteLine`) ; avertissement si le prix catalogue a augmenté de > 10 %. |
| Deux réceptionnaires éditent la même ligne | Verrouillage optimiste (`updatedAt`) : « Cette ligne a été modifiée par Bamba Aminata. Rechargez. » |
| Tablette hors-ligne pendant la réception | IndexedDB + `clientRequestId` ; photos envoyées en arrière-plan ; le numéro d'OR est attribué par le serveur à la synchro (affichage « OR provisoire »). |
| Mécanicien pointé sur un OR qu'on veut annuler | Refus : « Clôturez le pointage de Coulibaly Drissa avant d'annuler. » |
| OR prêt depuis 30 jours, client injoignable | Liste « Véhicules non récupérés » dans le tableau de bord ; frais de gardiennage proposés ; courrier type de mise en demeure (modèle M11). |
| Facture assurance + franchise client | Lignes `payer = INSURANCE` / `CUSTOMER` selon M16 ; la restitution exige seulement le règlement de la franchise et de la part client. |
| OR créé en mode `REMINDERS_ONLY` | Impossible : l'entrée « Ordres » est masquée (M15) ; l'API renvoie `MODULE_DISABLED`. |

## 12. Tests

**Unitaires (`core`)** : `stateMachine.canTransition` — chaque transition autorisée et chaque refus (gardes : lignes en attente, pointage ouvert, pièces sorties, QC NOK, facture émise) ; `lineTotals` (exemples RG-M04-05, arrondi par ligne, TVA désactivée, pièce client à 0) ; `autoApproval` (plafond 50 000 : cumul 48 000 → APPROVED ; + 5 000 → PENDING) ; `warrantyFor(line, deliveredAt, mileage)` et `isUnderWarranty(line, date, mileage)` (premier atteint) ; `isProbableComeback` (30 j / 1 000 km / catégorie commune) ; `canDeliver` (4 conditions RG-M04-14) ; `storageFee` (jours ouvrés, dimanche exclu) ; `CheckInSchema` (validation, « aucun dommage » vs liste vide).

**Intégration** : réception complète avec photos (URL signées, MIME contrôlé) et relevé km ; idempotence `clientRequestId` (deux synchros = un OR) ; inspection → devis (M05) → acceptation partielle → lignes approuvées + réservations M07 ; QC refus/validation ; `READY` → brouillon facture + message véhicule prêt dans `/dev/outbox` ; restitution bloquée sur solde puis débloquée par `payment.received` ; retour sous garantie (`payer = WARRANTY`, non facturé) ; isolation multi-locataire et portée par site ; vue publique sans données internes.

**E2E Playwright** (fil rouge étapes 3 à 8) : depuis le RDV de M. Kouassi → réception tablette (km 48 200, carburant 3/8, 4 photos, rayure aile AVG, objets, doléances, signature) → mécanicien fait l'inspection (1 urgent plaquettes AV, 3 à surveiller) → devis créé et accepté 2 lignes sur 3 via le portail → travaux → QC → « prêt » reçu par WhatsApp (outbox) → paiement enregistré → restitution signée → statut `INVOICED` après émission de la facture.

## 13. Définition de « terminé »

- [ ] Machine à états `core/repairOrders/stateMachine` complète et testée, utilisée par toutes les procédures et par le kanban.
- [ ] Assistant de réception tablette (6 étapes) avec schéma de carrosserie, photos compressées, signature, mode hors-ligne et synchronisation idempotente.
- [ ] Fiche OR (9 onglets), kanban, liste, QC, restitution, paramètres, modèles d'inspection.
- [ ] Inspection multipoints avec modèles semés, photos, recommandations, création du devis (M05).
- [ ] Lignes MO/pièces/consommables/sous-traitance/frais, pièce fournie par le client, approbation et plafond d'autorisation.
- [ ] Intégrations M07 (réservations/sorties), M08 (brouillon de facture, blocage restitution), M10/M11 (suivi, prêt, satisfaction).
- [ ] Garanties figées à la livraison, retours et décision de garantie, rapport des retours alimenté.
- [ ] 4 PDF (réception, atelier, OR, restitution) ; portail suivi et signature à distance.
- [ ] Événements idempotents, audit des actions sensibles (annulation, réouverture, livraison impayée, prix sous minimum, décision de garantie).
- [ ] Tests unitaires, intégration et E2E fil rouge verts.

## 14. Évolutions du modèle de données

```prisma
model RepairOrder {
  // champs existants…
  bayId                  String?                 // pont occupé (partagé M03/M06)
  publicToken            String?  @unique        // suivi client / signature à distance
  isComeback             Boolean  @default(false)
  comebackOfId           String?                 // OR d'origine
  warrantyDecision       WarrantyDecision?
  warrantyDecisionReason String?
  waitingPartsSince      DateTime?
  qcChecklist            Json?                   // [{ key, label, result: OK|NOK|NA }] + roadTest
  deliverySignatureUrl   String?
  cancelledAt            DateTime?
  cancelReason           String?
  invoicedAt             DateTime?
  createdById            String?
  @@index([organizationId, vehicleId])
  @@index([organizationId, siteId, status])
}
enum WarrantyDecision { COVERED NOT_COVERED PARTIAL }

model RepairOrderLine {
  // champs existants…
  isCustomerSupplied   Boolean  @default(false)  // pièce fournie par le client (unitPrice 0, non garantie)
  costPrice            Int?                      // coût unitaire (sous-traitance, pièce hors stock)
  supplierId           String?                   // sous-traitant / fournisseur ponctuel
  subcontractStatus    String?                   // TO_SEND | SENT | RETURNED
  subcontractExpectedAt DateTime?
  approvalSource       String?                   // CHECK_IN | PRE_AUTHORIZED | QUOTE | PHONE | IN_PERSON
  inspectionItemId     String?
  warrantyMonths       Int?
  warrantyKm           Int?
  warrantyUntilDate    DateTime? @db.Date        // figé à la livraison
  warrantyUntilMileage Int?
  completedAt          DateTime?
  completedById        String?                   // Membership.id
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@index([repairOrderId])
}

model InspectionItem {
  // champs existants…
  shareWithCustomer Boolean @default(true)
  sortOrder         Int     @default(0)
}

model Inspection {
  // champs existants…
  createdAt      DateTime @default(now())
  summary        Json?                          // { urgent, watch, ok, notChecked }
}

model InspectionTemplate {
  // champs existants…
  isDefault      Boolean @default(false)
  isActive       Boolean @default(true)
  // items: [{ category, label, measurementUnit?, recommendedLaborCode?, recommendedProductCategory? }]
}

model RepairOrderStatusHistory {
  id             String   @id @default(cuid())
  organizationId String
  repairOrderId  String
  fromStatus     RepairOrderStatus?
  toStatus       RepairOrderStatus
  transition     String
  reason         String?
  membershipId   String?                        // null = automatique
  createdAt      DateTime @default(now())
  @@index([repairOrderId, createdAt])
}

model VehicleRecommendation {                   // travaux conseillés non réalisés (relance M10)
  id               String   @id @default(cuid())
  organizationId   String
  vehicleId        String
  customerId       String
  repairOrderId    String?
  inspectionItemId String?
  quoteLineId      String?
  label            String                       // "Amortisseurs arrière"
  severity         InspectionResult             // WATCH | URGENT
  estimatedAmount  Int?                         // TTC
  remindAt         DateTime? @db.Date           // défaut : +90 jours
  status           String   @default("OPEN")    // OPEN | DONE | DISMISSED
  createdAt        DateTime @default(now())
  resolvedAt       DateTime?
  @@index([organizationId, vehicleId, status])
}
```

Nouvelle valeur d'enum suggérée pour M10 : `ReminderType.RECOMMENDED_WORK` (relance des travaux conseillés non réalisés) — à défaut, utiliser `CUSTOM` avec `ReminderRule.conditions.kind = "recommended_work"`.
Paramètres ajoutés dans `Organization.settings` : `repairOrders.*`, `laborRates`, `warranty` (§6).
