# M06 — Atelier : mécaniciens, tâches, pointage

> Priorité : P1 · Dépend de : M01, M02, M04, M05, M07 (demandes de pièces), M15 · Rôles concernés : `MANAGER`, `MECHANIC`, `ADVISOR`, `OWNER`, `STOREKEEPER`

## 1. Objectif

Rendre visible et mesurable ce qui se passe **dans l'atelier** : quel véhicule est où, qui travaille sur quoi, ce qui bloque (accord client, pièces, sous-traitant), et combien de temps chaque travail a réellement coûté par rapport à ce qui est facturé. Le mécanicien utilise une **PWA tablette** qui fonctionne hors-ligne (coupures réseau fréquentes dans les ateliers d'Abidjan) ; le chef d'atelier affecte, contrôle la qualité et suit l'efficacité de chacun.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait dans M06 | Fréquence |
|---|---|---|
| `MANAGER` chef d'atelier | Vue kanban et vue ponts, affecte les tâches, valide le contrôle qualité, gère la sous-traitance, corrige les pointages | Toute la journée |
| `MECHANIC` | Pointe présence, démarre/pause/termine ses tâches, photos, remarques, inspection multipoints, demande des pièces | 20 à 60 actions/jour |
| `ADVISOR` | Consulte l'avancement pour répondre au client, voit les retards sur la date promise | Plusieurs fois/heure |
| `STOREKEEPER` | Reçoit les demandes de pièces émises depuis la tablette (traitées dans M07) | Continu |
| `OWNER` | Consulte efficacité, productivité, temps facturé vs passé | Hebdomadaire |

## 3. User stories

**US-M06-01 — En tant que chef d'atelier, je veux un tableau kanban des OR par statut afin de voir en un coup d'œil ce qui est bloqué.**
- Étant donné 14 OR ouverts sur le site YOP, quand j'ouvre `/atelier`, alors je vois 7 colonnes (RG-M06-01) avec pour chaque carte : n° OR, plaque `2547 GH 01`, marque/modèle, client, mécaniciens affectés (initiales), avancement `3/5 tâches`, date promise, badges (priorité, pièces manquantes, sous-traitance).
- Étant donné un OR dont `promisedAt` est dépassé et qui n'est pas `READY`, alors sa carte porte un bandeau rouge « En retard de 2 h ».
- Étant donné que je glisse une carte de « En cours » vers « Contrôle qualité », quand toutes les tâches ne sont pas `DONE`, alors le dépôt est refusé avec le message « 2 tâches ne sont pas terminées ».
- Quand je glisse vers une colonne dont la transition n'est pas autorisée par M04, alors la colonne est grisée pendant le glisser et le dépôt est impossible.

**US-M06-02 — En tant que chef d'atelier, je veux une vue par pont afin d'occuper au mieux mes postes.**
- Étant donné 4 ponts (`Pont 1`, `Pont 2`, `Diagnostic`, `Carrosserie`), quand j'ouvre `/atelier/ponts`, alors je vois une colonne par `Bay` actif du site, l'OR présent sur chaque pont (`RepairOrder.bayId`) et une zone « Parking / sans pont ».
- Quand je glisse un OR sur un pont déjà occupé, alors une confirmation « Le Pont 2 est occupé par OR-YOP-2026-00041. Déplacer celui-ci vers le parking ? » s'affiche.

**US-M06-03 — En tant que chef d'atelier, je veux affecter chaque tâche au bon mécanicien selon ses compétences et sa charge.**
- Étant donné une ligne LABOR « Recharge climatisation » dont l'opération requiert la compétence `climatisation`, quand j'ouvre le sélecteur d'affectation, alors je vois les mécaniciens présents classés par score (RG-M06-04) avec : compétences, charge restante du jour en heures, statut (en tâche / libre / absent).
- Étant donné que j'affecte un mécanicien sans la compétence requise, alors un avertissement non bloquant « Ibrahim Ouattara n'a pas la compétence climatisation » s'affiche.
- Quand l'affectation est enregistrée, alors le mécanicien reçoit une `Notification` et la tâche apparaît dans sa tablette (à la prochaine synchronisation si hors-ligne).

**US-M06-04 — En tant que mécanicien, je veux voir mes tâches du jour sur la tablette afin de savoir quoi faire sans aller au bureau.**
- Étant donné que je suis connecté (ou identifié par PIN sur une tablette partagée), quand j'ouvre `/tablette/taches`, alors je vois mes lignes `PENDING` et `IN_PROGRESS` triées par priorité de l'OR puis `promisedAt`, avec plaque, véhicule, description, temps barème, doléance client.
- Étant donné que le réseau est coupé, alors la liste s'affiche depuis IndexedDB avec le bandeau « Hors-ligne — dernière synchro à 10:42 ».

**US-M06-05 — En tant que mécanicien, je veux démarrer, mettre en pause et terminer une tâche afin que mon temps soit compté sans effort.**
- Quand j'appuie sur « Démarrer » sur une ligne `PENDING`, alors un `TimeEntry` est créé (`startedAt` = maintenant), la ligne passe `IN_PROGRESS`, et l'OR passe `IN_PROGRESS` s'il était `APPROVED` (transition M04).
- Étant donné que j'ai déjà une tâche en cours, quand je démarre une autre tâche, alors la première est automatiquement mise en pause (RG-M06-06) et un message l'indique.
- Quand j'appuie sur « Pause », je choisis un motif (attente pièce, pause déjeuner, attente accord, autre) ; à la reprise, la durée de pause est ajoutée à `pauseMinutes`.
- Quand j'appuie sur « Terminer », alors l'entrée est close, la ligne passe `DONE`, et je peux ajouter une remarque et des photos. Si c'était la dernière ligne non terminée de l'OR, le chef d'atelier reçoit « OR-YOP-2026-00042 prêt pour contrôle qualité ».

**US-M06-06 — En tant que mécanicien, je veux prendre des photos et laisser des remarques afin de justifier le travail auprès du client.**
- Quand je prends une photo depuis la tâche, alors elle est compressée (max 1600 px, WebP), stockée localement si hors-ligne, puis envoyée comme `Attachment` (`entity = "repair_order_line"`, `kind = "photo_work"`).
- Une remarque peut être marquée « visible client » ; elle apparaît alors dans le suivi du portail (M14) après validation par le conseiller.

**US-M06-07 — En tant que mécanicien, je veux demander une pièce au magasin depuis la tablette afin de ne pas quitter le véhicule.**
- Quand je recherche « plaquette » ou scanne un code-barres, alors je vois les produits compatibles avec le véhicule en premier (`Product.compatibleWith`) et le stock disponible du site.
- Quand j'envoie la demande (produit ou texte libre si introuvable, quantité, urgence), alors une `PartRequest` `REQUESTED` est créée, le magasinier est notifié, et je peux mettre ma tâche en pause « attente pièce ».
- Quand le magasinier marque la demande `DELIVERED`, alors je reçois une notification et la pièce est ajoutée à l'OR comme ligne PART (approbation client selon M04/M05 si non prévue au devis).

**US-M06-08 — En tant que mécanicien, je veux remplir l'inspection multipoints point par point afin de générer le devis complémentaire.**
- Étant donné un OR avec une `Inspection` créée depuis un `InspectionTemplate`, quand j'ouvre `/tablette/inspection/[id]`, alors les points sont groupés par catégorie avec trois gros boutons OK / À surveiller / Urgent (cibles ≥ 44 px) et un champ mesure (« 3 mm »).
- Étant donné un point `URGENT` ou `WATCH`, alors une photo et un commentaire sont demandés (photo obligatoire pour `URGENT`, paramétrable).
- Quand je termine l'inspection, alors `completedAt` est renseigné, aucun point ne peut rester vide (`NOT_CHECKED` doit être choisi explicitement) et le conseiller reçoit « Inspection terminée : 1 urgent, 3 à surveiller » avec un bouton « Créer le devis » (M05).

**US-M06-09 — En tant que mécanicien, je veux pointer mon arrivée et mon départ afin que ma présence soit enregistrée.**
- Quand j'appuie « Arrivée » à 07:48, alors l'`Attendance` du jour est créée avec `clockIn`. Un second appui ne crée pas de doublon.
- Étant donné que j'ai une tâche en cours, quand je pointe « Départ », alors la tâche est mise en pause automatiquement.
- Étant donné un oubli de pointage de départ, alors à 23:59 le worker clôt la présence à l'heure de fin de la dernière `TimeEntry` (ou à la fermeture du site) et marque `autoClosed = true` pour revue.

**US-M06-10 — En tant que chef d'atelier, je veux effectuer le contrôle qualité avant la restitution.**
- Étant donné un OR en `QUALITY_CHECK`, quand j'ouvre la fiche CQ, alors je vois la checklist (essai routier, serrage roues, niveaux, propreté, voyants, travaux du devis tous faits) et les photos des tâches.
- Quand je valide « Conforme », alors `QualityCheck.result = PASSED`, `RepairOrder.qcById/qcAt` sont renseignés, l'OR passe `READY` et l'événement M04 déclenche la notification « véhicule prêt » (M11).
- Quand je refuse, alors je sélectionne les lignes à reprendre et un motif ; ces lignes repassent `PENDING` avec le même mécanicien, l'OR repasse `IN_PROGRESS`, et le temps de reprise est pointé avec `kind = REWORK` (non facturable).

**US-M06-11 — En tant que chef d'atelier, je veux suivre les travaux sous-traités (rectification culasse, ligne d'échappement, sellerie).**
- Quand je crée une ligne `SUBCONTRACT` avec sous-traitant (`Supplier`), coût convenu 45 000 FCFA, prix de vente 60 000 FCFA et date de retour prévue, alors la ligne apparaît dans `/atelier/sous-traitance` en `TO_SEND`.
- Quand la pièce part, je passe `SENT` ; à son retour, `RETURNED` ; la date de retour dépassée met la ligne en rouge.

**US-M06-12 — En tant que gérant, je veux comparer temps facturé et temps passé par mécanicien afin de savoir qui est rentable.**
- Étant donné la semaine du 12/10/2026, quand j'ouvre `/atelier/productivite`, alors je vois par mécanicien : heures de présence, heures pointées sur OR, heures facturées, efficacité, productivité, rendement global, heures de reprise, coût MO (RG-M06-08 à 10).

## 4. Règles métier

**RG-M06-01 — Colonnes du kanban** (correspondance `RepairOrderStatus`) :

| Colonne | Statuts |
|---|---|
| À diagnostiquer | `CHECKED_IN`, `DIAGNOSING` |
| Attente accord | `AWAITING_APPROVAL` |
| Prêt à démarrer | `APPROVED` |
| En cours | `IN_PROGRESS` |
| Attente pièces | `WAITING_PARTS` |
| Contrôle qualité | `QUALITY_CHECK` |
| Prêt | `READY` (masqué après `DELIVERED`) |

`DRAFT`, `DELIVERED`, `INVOICED`, `CANCELLED` ne sont pas affichés. Les transitions sont **celles de M04** ; M06 n'en définit aucune nouvelle et appelle `repairOrder.changeStatus`.

**RG-M06-02 — Retard.** Un OR est en retard si `promisedAt < maintenant` et statut ∉ {`READY`, `DELIVERED`, `INVOICED`, `CANCELLED`}. Seuil d'alerte « à risque » : `promisedAt − maintenant < heures barème restantes` où heures restantes = Σ `quantity` des lignes LABOR non `DONE`.

**RG-M06-03 — Pont.** Un pont accueille au plus **un** OR actif (statut entre `CHECKED_IN` et `QUALITY_CHECK`). Un OR passé `READY` libère automatiquement son pont (`bayId = null`) sauf paramètre `atelier.keepBayUntilDelivery`.

**RG-M06-04 — Score d'affectation suggérée** (fonction pure `core/workshop/scoreAssignment`) pour chaque mécanicien actif présent sur le site :
- `skillMatch` = 1 si `LaborOperation.requiredSkill` est vide ou ∈ `Membership.skills`, sinon 0.
- `remainingLoad` = Σ `quantity` (heures) des lignes LABOR affectées, non `DONE`/`CANCELLED`, des OR ouverts du site.
- `availableHours` = heures restantes jusqu'à la fermeture du site aujourd'hui (`Site.openingHours`), minimum 0,5.
- `loadRatio` = min(`remainingLoad` / `availableHours`, 2).
- `score = 100 × skillMatch − 40 × loadRatio + 15 × (déjà affecté sur cet OR) − 100 × (absent ou sans clockIn)`.
- Exemple : Konan Yao (compétence OK, 3 h restantes, 6 h disponibles) → 100 − 20 = **80** ; Ibrahim Ouattara (pas la compétence, 1 h, 6 h) → 0 − 6,7 = **−6,7**. M17 peut proposer une affectation plus fine (historique des temps réels par type d'opération), toujours soumise à validation humaine.

**RG-M06-05 — Durée d'un pointage.** `durationMinutes = (endedAt − startedAt) en minutes − pauseMinutes`, arrondi à la minute inférieure, jamais négatif. Une entrée en cours (`endedAt = null`) compte jusqu'à maintenant, moins la pause en cours si `pausedAt` est renseigné.

**RG-M06-06 — Une seule tâche active.** Un mécanicien a au plus **une** `TimeEntry` ouverte non en pause. Démarrer une tâche met en pause l'éventuelle tâche active. Le travail en binôme se fait par deux entrées distinctes (une par mécanicien) sur la même ligne.

**RG-M06-07 — Pause.** `pause` : `pausedAt = maintenant`, `pauseReason`. `resume` : `pauseMinutes += floor((maintenant − pausedAt)/60 s)`, `pausedAt = null`. `stop` sur une entrée en pause : on ajoute la pause en cours puis `endedAt = pausedAt` (le temps de pause terminal n'est pas compté). Une pause de plus de 4 h ou passant minuit est close automatiquement par le worker (`endedAt = pausedAt`).

**RG-M06-08 — Temps facturé attribué.** Pour une ligne LABOR facturée (présente sur une facture `ISSUED` ou au-delà, hors avoir), les heures vendues `quantity` sont réparties entre mécaniciens **au prorata de leurs minutes pointées** (hors `REWORK`) sur la ligne. Si personne n'a pointé, elles sont attribuées à `assignedToId`. Les lignes `payer = WARRANTY` ou `INTERNAL` sont comptées à part (« heures non facturées client »).

**RG-M06-09 — Indicateurs par mécanicien et période** :
- Présence `P` = Σ (`clockOut − clockIn` − `breakMinutes`) des `Attendance`.
- Pointé `T` = Σ durées `TimeEntry` (tous `kind`), Reprise `R` = part `REWORK`.
- Facturé `F` = heures attribuées (RG-M06-08).
- **Efficacité** = `F / T × 100` ; **Productivité** = `T / P × 100` ; **Rendement global** = `F / P × 100`. Arrondis à l'entier ; « — » si dénominateur nul.
- Exemple Konan Yao, mardi : présence 07:45–17:15 moins 60 min de pause = **8,5 h** ; pointé **7,0 h** ; facturé **7,8 h** (vidange barème 1 h faite en 0,7 h, etc.). Efficacité **111 %**, productivité **82 %**, rendement **92 %**.

**RG-M06-10 — Coût MO.** `coût = T × Membership.hourlyCost` (entier FCFA, arrondi par entrée). Marge MO d'un OR = Σ HT des lignes LABOR facturées − Σ coûts des entrées de l'OR. Exemple : 7,8 h × 15 000 = 117 000 FCFA HT vendus ; 7,0 h × 2 500 = 17 500 FCFA de coût.

**RG-M06-11 — Contrôle qualité obligatoire** si `settings.atelier.qcRequired = true` (défaut) : l'OR ne peut passer `READY` que via un `QualityCheck` `PASSED`. Le contrôleur ne peut pas être l'unique mécanicien ayant pointé sur l'OR, sauf permission `workshop:qc_self` (petits garages).

**RG-M06-12 — Sous-traitance.** Ligne `SUBCONTRACT` : `subcontractorId` (Supplier), `subcontractCost` (coût d'achat, entier FCFA), `unitPrice` (vente). Alerte si `unitPrice × quantity < subcontractCost` (« Sous-traitance vendue à perte »). Statuts `SubcontractStatus` (§5). La ligne ne peut être facturée qu'en `RETURNED`.

**RG-M06-13 — Hors-ligne.** Cache local : tâches affectées des OR ouverts du site (max 7 jours), fiches véhicule résumées, modèles d'inspection, catalogue produits du site (champs : id, sku, nom, code-barres, compatibilité, disponible). File d'opérations locale (`outbox`) avec un `clientOpId` (UUID v4) par opération. Synchronisation : au retour réseau, à l'ouverture, et toutes les 60 s si en ligne.

**RG-M06-14 — Résolution de conflits** (« serveur gagne sauf pointage », 01 §11) :
- Pointages (`start`, `pause`, `resume`, `stop`) : toujours acceptés avec `source = "offline-sync"`, même si la ligne a été annulée entre-temps (temps réel passé ; drapeau `needsReview`).
- Horloge : chaque synchro mesure `serverOffset = serverNow − deviceNow` et le stocke ; les horodatages hors-ligne sont corrigés de ce décalage. Un horodatage dans le futur serveur est ramené à l'heure de réception.
- Chevauchement de deux entrées du même mécanicien : la plus ancienne est close au `startedAt` de la suivante, `needsReview = true`.
- Changement de statut de ligne : refusé si la ligne est `CANCELLED` côté serveur (l'opération revient en erreur visible sur la tablette).
- Inspection : dernier écrit gagne **par point** (`InspectionItem`), pas pour l'inspection entière.
- Opération déjà appliquée (`clientOpId` connu) : réponse `ok` sans effet (idempotence).

**RG-M06-15 — Tablette partagée.** Si `settings.atelier.sharedTablets = true`, l'écran d'accueil liste les mécaniciens du site ; identification par PIN 4 à 6 chiffres (`Membership.pinHash`, argon2). Verrouillage après 2 min d'inactivité. 5 PIN faux → blocage 5 min. La session de l'appareil (`deviceId`) reste celle du site ; l'acteur des opérations est le mécanicien identifié.

**RG-M06-16 — Correction de pointage.** Seul `MANAGER`/`OWNER` (permission `timeentry:edit`) modifie une entrée après coup ; motif obligatoire ; `AuditLog` avant/après. Un mécanicien peut corriger sa propre entrée de moins de 15 min (oubli de démarrage) une fois, tracée.

## 5. Machines à états

**Ligne de travail (`RepairOrderLine.status`)** — vue atelier :

| De | Vers | Déclencheur | Effets |
|---|---|---|---|
| `PENDING` | `IN_PROGRESS` | `tech.startTask` | crée `TimeEntry` ; OR `APPROVED → IN_PROGRESS` (M04) ; événement `workshop.task_started` |
| `IN_PROGRESS` | `DONE` | `tech.completeTask` | clôt l'entrée ; si toutes les lignes LABOR/SUBCONTRACT `DONE`/`CANCELLED` → notification CQ |
| `DONE` | `PENDING` | `qc.fail` (reprise) | nouvelle entrée `kind = REWORK` au redémarrage |
| `PENDING`/`IN_PROGRESS` | `CANCELLED` | `MANAGER`/`ADVISOR` via M04 (client refuse) | clôt l'entrée ouverte |

La pause n'est pas un statut de ligne : elle se lit sur la `TimeEntry` ouverte (`pausedAt ≠ null`) et s'affiche « En pause ».

**`TimeEntry`** : `RUNNING` (endedAt null, pausedAt null) ↔ `PAUSED` (pausedAt ≠ null) → `STOPPED` (endedAt ≠ null). États dérivés, non stockés.

**`PartRequest.status`** : `REQUESTED → PREPARING → DELIVERED` ; `REQUESTED → ORDERED` (création d'un bon de commande M07) `→ DELIVERED` ; `REQUESTED/PREPARING → REJECTED` (motif obligatoire) ; `REQUESTED → CANCELLED` (par le demandeur). Événement `part_request.status_changed`.

**`QualityCheck.result`** : `PASSED` (OR → `READY`) ou `FAILED` (OR → `IN_PROGRESS`, lignes choisies → `PENDING`). Plusieurs contrôles successifs par OR sont conservés.

**`SubcontractStatus`** : `TO_SEND → SENT → RETURNED` ; `TO_SEND/SENT → CANCELLED`.

## 6. Données

Entités de 02 utilisées : `RepairOrder` (statut, `qcById`, `qcAt`, `promisedAt`, `priority`), `RepairOrderLine` (`assignedToId`, `status`, `type`), `TimeEntry`, `Attendance`, `Inspection`, `InspectionItem`, `InspectionTemplate`, `LaborOperation` (`standardHours`), `Membership` (`skills`, `hourlyCost`), `Bay`, `Site` (`openingHours`), `Attachment`, `Notification`, `Supplier` (sous-traitants), `Product`, `StockLevel` (lecture), `AuditLog`, `DomainEvent`.

Nouveaux champs et entités : voir §14 (`RepairOrder.bayId`, `TimeEntry.pausedAt/kind/clientOpId/needsReview`, `Attendance.breakMinutes/autoClosed`, `Membership.pinHash`, `LaborOperation.requiredSkill`, `QualityCheck`, `PartRequest`, champs de sous-traitance, `WorkNote`).

Stockage local (Dexie, base `atelieros-tech`) :

```ts
db.version(1).stores({
  tasks: 'id, repairOrderId, status, updatedAt',        // RepairOrderLine + résumé OR/véhicule
  inspections: 'id, repairOrderId',                     // Inspection + items
  products: 'id, sku, barcode, *compatibleWith',
  outbox: '++seq, clientOpId, type, createdAt',         // opérations en attente
  blobs: 'clientOpId',                                  // photos en attente d'envoi
  meta: 'key'                                           // lastSyncAt, serverOffset, deviceId, membershipId
});
```

## 7. Écrans et interface

| Route | Contenu | Actions / filtres | Mobile |
|---|---|---|---|
| `/atelier` | Kanban (RG-M06-01), compteur par colonne, bandeau « 3 OR en retard » | Filtres : site, conseiller, mécanicien, priorité, « en retard » ; glisser-déposer (`@dnd-kit`) ; clic → panneau latéral OR (tâches, pointages, photos) | Colonnes en onglets horizontaux |
| `/atelier/ponts` | Une colonne par `Bay`, zone parking, mécaniciens actifs par OR | Glisser OR ↔ pont ; marquer pont indisponible | Liste verticale |
| `/atelier/mecaniciens` | Une carte par mécanicien : présent/absent, tâche en cours + chrono, charge restante, compétences | Affecter depuis une liste de lignes non affectées (glisser) | Liste |
| `/atelier/pointages` | Tableau des `TimeEntry` (filtre date, mécanicien, OR, `needsReview`) et présences du jour | Corriger (motif), valider les entrées signalées, export CSV | Lecture |
| `/atelier/controle-qualite` | OR en `QUALITY_CHECK` ; fiche CQ avec checklist (`settings.atelier.qcChecklist`), photos | Conforme / Reprise (sélection des lignes + motif) | Optimisé tablette |
| `/atelier/sous-traitance` | Lignes `SUBCONTRACT` par statut, sous-traitant, retour prévu | Changer statut, joindre bon du sous-traitant | Liste |
| `/atelier/productivite` | Tableau RG-M06-09 par mécanicien, graphique Recharts F/T/P par semaine | Période, site ; export CSV | Tableau défilant |
| `/tablette` | Accueil : sélection mécanicien + PIN (si partagé), boutons Arrivée / Départ | — | Plein écran tablette |
| `/tablette/taches` | Mes tâches (cartes larges), chrono de la tâche active, indicateur réseau et file en attente (« 3 actions à synchroniser ») | Démarrer / Pause (motif) / Reprendre / Terminer | Natif |
| `/tablette/taches/[lineId]` | Détail : doléance, diagnostic, historique véhicule résumé, photos, remarques, pièces de l'OR et leur état (réservée, sortie, en commande) | Photo, remarque (interne / visible client), demande de pièce (recherche, scan caméra M07), terminer | Natif |
| `/tablette/inspection/[inspectionId]` | Points par catégorie, 3 boutons, mesure, photo, commentaire, saisie vocale (M17) | Terminer l'inspection | Natif |

États : vide (« Aucune tâche pour vous aujourd'hui — demandez au chef d'atelier »), chargement (squelettes), erreur de synchro (bandeau orange avec détail par opération et bouton « Réessayer »), conflit refusé (carte rouge « Cette tâche a été annulée par le bureau »).

## 8. API (tRPC)

| Procédure | Entrée | Sortie |
|---|---|---|
| `workshop.board` | `{ siteId, filters? }` | `{ columns: [{ key, repairOrders: BoardCard[] }] }` |
| `workshop.bays` | `{ siteId }` | `{ bays: [{ bay, repairOrder?, mechanics[] }], parking: BoardCard[] }` |
| `workshop.assignBay` | `{ repairOrderId, bayId \| null, force?: boolean }` | `{ repairOrder, displaced?: repairOrderId }` |
| `workshop.mechanics` | `{ siteId, date }` | `[{ membership, attendance, activeEntry?, remainingLoad, skills }]` |
| `workshop.suggestAssignees` | `{ repairOrderLineId }` | `[{ membershipId, score, reasons[] }]` (top 5) |
| `workshop.assignLine` | `{ repairOrderLineId, membershipId \| null }` | `{ line }` |
| `workshop.timeEntries` | `{ siteId, from, to, membershipId?, needsReview? , cursor }` | page de `TimeEntry` |
| `workshop.editTimeEntry` | `{ id, startedAt, endedAt, pauseMinutes, reason }` | `{ entry }` |
| `workshop.productivity` | `{ siteId?, from, to }` | `[{ membershipId, presenceH, workedH, billedH, reworkH, efficiency, productivity, overall, laborCost }]` |
| `workshop.qc.get` | `{ repairOrderId }` | `{ checklist, lines, photos, previousChecks[] }` |
| `workshop.qc.submit` | `{ repairOrderId, result, checklist: Record<string,boolean>, comment?, reworkLineIds?: string[] }` | `{ qualityCheck, repairOrder }` |
| `workshop.subcontract.list` / `.updateStatus` | `{ status? }` / `{ lineId, status, returnedAt? }` | lignes / ligne |
| `tech.bootstrap` | `{ siteId }` | snapshot pour Dexie : tâches, inspections, produits du site, `serverNow` |
| `tech.sync` | `{ deviceId, deviceNow, ops: TechOp[] }` (≤ 200 ops, ordre `seq`) | `{ serverNow, results: [{ clientOpId, status: 'ok' \| 'rejected', error?, entityId? }], changes: delta depuis lastSyncAt }` |
| `tech.uploadPhoto` | multipart (URL S3 présignée) `{ clientOpId, entity, entityId, caption? }` | `{ attachment }` |
| `tech.verifyPin` | `{ siteId, membershipId, pin }` | `{ actorToken }` (durée 12 h) |
| `attendance.clockIn` / `.clockOut` | `{ at?, clientOpId }` | `{ attendance }` |
| `partRequest.create` | `{ repairOrderId, repairOrderLineId?, productId?, freeText?, quantity, urgency }` | `{ partRequest }` |

`TechOp` = union discriminée sur `type` : `task.start`, `task.pause` (`reason`), `task.resume`, `task.complete` (`note?`), `note.add` (`body`, `visibleToCustomer`), `photo.attach`, `inspection.setItem` (`itemId`, `result`, `measurement?`, `comment?`), `inspection.complete`, `attendance.in`, `attendance.out`, `partRequest.create`. Chaque op porte `clientOpId`, `at` (heure appareil), `actorMembershipId`.

Pas d'endpoint REST public pour M06 en v1 (lecture des temps via export CSV).

## 9. Automatisations et événements

| Événement | Émis quand | Consommé par |
|---|---|---|
| `workshop.task_started` / `workshop.task_completed` | start / complete | M04 (statut OR), M12 |
| `workshop.ro_ready_for_qc` | dernière ligne terminée | Notification `MANAGER` |
| `workshop.qc_passed` / `workshop.qc_failed` | CQ | M04 (`READY` / `IN_PROGRESS`), M11 (véhicule prêt via `repair_order.status_changed`) |
| `part_request.created` / `.status_changed` | demande de pièce | M07 (file magasin), Notification mécanicien |
| `inspection.completed` | fin d'inspection | M05 (proposition de devis), M17 (brouillon de devis) |

Consommés : `repair_order.status_changed` (rafraîchir le tableau via invalidation tRPC ; poll 30 s, pas de websocket en v1), `quote.accepted` (lignes acceptées deviennent affectables), `stock.received` (M07 : met à jour l'état « pièce arrivée » dans la tablette).

Tâches worker :
- `workshop.close_stale` (tous les jours 23:59, fuseau org) : clôt pauses > 4 h, entrées ouvertes, présences sans départ (RG-M06-09) avec `needsReview`/`autoClosed`.
- `workshop.late_alerts` (toutes les 15 min, heures d'ouverture) : notifie le conseiller des OR passant « à risque » (RG-M06-02), une seule fois par OR et par jour.

IA (M17, non réimplémentée ici) : dictée vocale → texte des remarques et commentaires d'inspection ; suggestion de diagnostic à partir de la doléance ; brouillon de devis à partir des points `URGENT`/`WATCH` ; affinage du score d'affectation. Toujours en suggestion, validée par l'humain.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir kanban / ponts | `workshop:view` | OWNER, MANAGER, ADVISOR, STOREKEEPER |
| Déplacer un OR (statut / pont) | `workshop:move` | OWNER, MANAGER, ADVISOR |
| Affecter une tâche | `workshop:assign` | OWNER, MANAGER |
| Pointer sur ses tâches | `timeentry:own` | MECHANIC, MANAGER |
| Pointer pour un autre | `timeentry:others` | MANAGER |
| Corriger un pointage | `timeentry:edit` | OWNER, MANAGER |
| Inspection | `inspection:perform` | MECHANIC, MANAGER |
| Contrôle qualité | `workshop:qc` | OWNER, MANAGER |
| CQ sur son propre travail | `workshop:qc_self` | OWNER |
| Demande de pièce | `partrequest:create` | MECHANIC, MANAGER, ADVISOR |
| Sous-traitance | `workshop:subcontract` | OWNER, MANAGER |
| Productivité, coûts MO | `workshop:productivity` | OWNER, MANAGER |

Un `MECHANIC` ne voit sur la tablette ni les prix de vente ni `hourlyCost` ; il voit les heures barème.

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Tablette hors-ligne toute la matinée, 37 opérations en file | Envoi par lots de 200 dans l'ordre ; affichage « Synchronisation 37/37 » ; les rejets restent listés avec leur motif |
| Mécanicien oublie d'arrêter sa tâche avant de partir | Pointage « Départ » met en pause ; sinon clôture auto à 23:59 avec `needsReview` ; apparaît dans `/atelier/pointages` |
| Deux mécaniciens sur la même ligne (dépose moteur) | Deux entrées ; heures facturées réparties au prorata (RG-M06-08) |
| Ligne annulée par le bureau pendant que le mécanicien travaille hors-ligne | Pointage conservé (`needsReview`), « Terminer » rejeté : « Tâche annulée par le bureau. Votre temps a été enregistré. » |
| Horloge de la tablette en avance de 2 h | Correction par `serverOffset` ; si aucun offset connu et écart > 5 min à la synchro, entrée signalée |
| Photo de 8 Mo prise hors-ligne, stockage IndexedDB plein | Compression avant stockage ; si quota dépassé : « Mémoire pleine : synchronisez avant de prendre d'autres photos » |
| Tentative de passer `READY` sans CQ | « Le contrôle qualité est obligatoire avant de déclarer le véhicule prêt. » |
| Pont supprimé/désactivé avec OR dessus | OR renvoyé au parking, notification au chef d'atelier |
| Mécanicien désactivé (`Membership.isActive = false`) avec tâches affectées | Tâches désaffectées, entrée ouverte close, alerte « 3 tâches à réaffecter » |
| Sous-traitance vendue sous le coût | Avertissement ; enregistrement possible avec motif |
| Efficacité > 300 % | Affichée mais signalée « à vérifier » (pointage probablement oublié) |
| PIN oublié | Le chef d'atelier réinitialise le PIN depuis `/parametres/equipe` (M15) |

## 12. Tests

Unitaires (`packages/core/workshop`) :
- `computeDuration` : avec/sans pause, pause en cours, entrée ouverte, valeurs négatives impossibles.
- `scoreAssignment` : exemples RG-M06-04 (80 et −6,7), absent, plafonnement `loadRatio`.
- `attributeBilledHours` : prorata deux mécaniciens (3 h et 1 h pointées, 5 h vendues → 3,75 h / 1,25 h), aucun pointage → `assignedToId`, exclusion `REWORK`.
- `productivityMetrics` : exemple Konan Yao (111 / 82 / 92), dénominateur nul.
- `resolveSyncOps` : idempotence `clientOpId`, chevauchement, ligne annulée, correction d'offset, horodatage futur.

Intégration : `tech.sync` avec base de test (lots ordonnés, rejet partiel), `workshop.qc.submit` FAILED → lignes `PENDING` et OR `IN_PROGRESS`, isolation multi-locataire (un mécanicien de l'org B ne peut pas pointer sur un OR de A), permission `timeentry:edit`.

E2E Playwright : « Le chef d'atelier affecte la vidange de 2547 GH 01 à Konan Yao → sur la tablette (contexte navigateur `offline: true`) Konan démarre, met en pause, reprend, prend une photo, termine → retour en ligne, synchro → la carte passe en Contrôle qualité → le chef valide → l'OR est `READY` et le pointage apparaît dans `/atelier/pointages` avec `source = offline-sync` ».

## 13. Définition de « terminé »

- [ ] Kanban et vue ponts fonctionnels avec glisser-déposer respectant les transitions M04.
- [ ] Affectation avec score, avertissement compétence, notification.
- [ ] PWA installable (Serwist), fonctionnement hors-ligne testé (E2E offline), file Dexie, idempotence, correction d'horloge.
- [ ] Pointage tâches (start/pause/resume/stop) et présence, clôtures automatiques du worker.
- [ ] Inspection multipoints sur tablette, création de devis déclenchée.
- [ ] Demandes de pièces reliées à M07.
- [ ] Contrôle qualité avec reprise, sous-traitance avec statuts.
- [ ] Indicateurs RG-M06-09/10 justes sur jeu de test, export CSV.
- [ ] Audit des corrections de pointage ; permissions vérifiées côté serveur.
- [ ] Libellés dans `fr.json` ; cibles tactiles ≥ 44 px ; tests unitaires `core` verts.

## 14. Évolutions du modèle de données

```prisma
model RepairOrder {
  // … champs existants
  bayId            String?                 // pont actuel (RG-M06-03)
}

model RepairOrderLine {
  // … champs existants
  subcontractorId     String?              // Supplier.id (type SUBCONTRACT)
  subcontractCost     Int?                 // coût d'achat FCFA
  subcontractStatus   SubcontractStatus?
  subcontractDueAt    DateTime?
  subcontractReturnedAt DateTime?
}
enum SubcontractStatus { TO_SEND SENT RETURNED CANCELLED }

model TimeEntry {
  // … champs existants
  kind          TimeEntryKind @default(WORK)
  pausedAt      DateTime?
  pauseReason   String?                    // parts | lunch | approval | other
  clientOpId    String?  @unique            // idempotence de la synchro hors-ligne
  deviceId      String?
  needsReview   Boolean  @default(false)
  @@index([organizationId, membershipId, startedAt])
}
enum TimeEntryKind { WORK DIAGNOSTIC REWORK }

model Attendance {
  // … champs existants
  siteId        String?
  breakMinutes  Int      @default(60)
  autoClosed    Boolean  @default(false)
  @@unique([organizationId, membershipId, date])
}

model Membership {
  // … champs existants
  pinHash       String?                    // PIN tablette partagée (argon2)
}

model LaborOperation {
  // … champs existants
  requiredSkill String?                    // doit correspondre à une valeur de Membership.skills
}

model QualityCheck {
  id             String   @id @default(cuid())
  organizationId String
  repairOrderId  String
  checkedById    String                    // Membership.id
  result         QcResult
  checklist      Json     @default("{}")   // { "essai_routier": true, "serrage_roues": true, … }
  comment        String?
  reworkLineIds  String[]
  createdAt      DateTime @default(now())
  @@index([organizationId, repairOrderId])
}
enum QcResult { PASSED FAILED }

model PartRequest {                        // demande de pièce tablette → magasin (traitée dans M07)
  id                String   @id @default(cuid())
  organizationId    String
  siteId            String
  repairOrderId     String
  repairOrderLineId String?
  requestedById     String                 // Membership.id
  productId         String?
  freeText          String?                // si produit introuvable
  quantity          Float
  urgency           Priority @default(NORMAL)
  status            PartRequestStatus @default(REQUESTED)
  handledById       String?
  purchaseOrderId   String?
  rejectReason      String?
  clientOpId        String?  @unique
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([organizationId, siteId, status])
}
enum PartRequestStatus { REQUESTED PREPARING ORDERED DELIVERED REJECTED CANCELLED }

model WorkNote {                           // remarques mécanicien sur un OR / une ligne
  id                String   @id @default(cuid())
  organizationId    String
  repairOrderId     String
  repairOrderLineId String?
  authorId          String                 // Membership.id
  body              String
  visibleToCustomer Boolean  @default(false)
  approvedById      String?                // conseiller ayant validé la diffusion
  clientOpId        String?  @unique
  createdAt         DateTime @default(now())
}
```

Convention (sans changement de schéma) : `Attachment.entity` accepte aussi `repair_order_line`, `quality_check`, `part_request` ; `Attachment.kind` accepte `photo_work`. Paramètres `Organization.settings.atelier` : `qcRequired`, `qcChecklist`, `sharedTablets`, `keepBayUntilDelivery`, `photoRequiredOnUrgent`.
