# M10 — Moteur de relances automatiques

> Priorité : **P0** · Dépend de : M01, M02, M03, M04, M05, M08, M09, M11, M13, M15 (M17 en option) · Rôles concernés : OWNER, MANAGER, ADVISOR, ACCOUNTANT, CASHIER

## 1. Objectif

C'est le module qui répond aux trois douleurs du client pilote : **visites techniques oubliées, révisions non rappelées, créances qui traînent**. Le moteur calcule chaque jour, pour chaque client, ce qui arrive à échéance, choisit **le bon palier, le bon canal, le bon moment**, puis envoie automatiquement ou dépose la relance dans la file « Relances du jour » pour validation.
Un système de relances échoue en vrai pour cinq raisons : doublons, harcèlement (trop de messages), mauvais moment (dimanche, jour férié, 22 h), données fausses (VT mal importée, facture déjà payée) et absence d'arrêt quand le client a réagi. Chaque règle de ce PRD vise l'une de ces causes. Le principe directeur : **mieux vaut une relance de moins qu'une relance fausse**.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| ADVISOR (réception) | Traite la file « Relances du jour » : envoyer, modifier, reporter, ignorer ; marque « RDV pris » / « VT effectuée » ; appelle les clients sans téléphone mobile | Quotidienne (matin) |
| OWNER | Choisit auto/validation par palier, valide les relances fermes et mises en demeure, consulte les résultats | Quotidienne (téléphone) |
| MANAGER | Paramètre les règles (frise), les fenêtres d'envoi, les jours fériés | Mensuelle |
| ACCOUNTANT / CASHIER | Valide les relances de créances, enregistre paiements et promesses (M09) qui arrêtent les relances | Quotidienne |
| Système (worker) | Planifie toutes les heures, envoie toutes les 5 min, mesure les résultats chaque nuit | Continue |

## 3. User stories

**US-M10-01 — En tant qu'OWNER, je veux que les rappels de VT partent automatiquement afin de ne plus dépendre de la mémoire de la réception.**
- Étant donné la règle « Visite technique » active avec J-30 en envoi automatique et la Toyota Corolla `2547 GH 01` de M. Kouassi Jean-Marc dont `inspectionExpiryDate = 2026-11-02`, quand `reminders.plan` tourne le 03/10/2026, alors un `Reminder` `INSPECTION`, `stepKey = "J-30"`, `status = PLANNED`, `scheduledFor = 2026-10-03T09:00:00Z` est créé avec `dedupeKey = "INSPECTION:<vehicleId>:2026-11-02:J-30"`.
- Quand `reminders.dispatch` tourne à 09:00, alors un message WhatsApp est mis en file (M11) et le `Reminder` passe `QUEUED` puis `SENT` à réception du statut fournisseur.
- Quand `reminders.plan` repasse à 10:00, alors aucun second `Reminder` n'est créé (contrainte unique `[organizationId, dedupeKey]`).

**US-M10-02 — En tant qu'ADVISOR, je veux une file « Relances du jour » afin de valider en une fois ce qui doit partir.**
- Étant donné 23 relances `NEEDS_APPROVAL` dont 8 créances, quand je filtre « Créance », que je coche 8 lignes et clique « Envoyer la sélection », alors une modale récapitule « 8 messages : 6 WhatsApp, 2 SMS » ; après confirmation, les 8 reçoivent `approvedAt` et repassent `PLANNED` avec `scheduledFor = maintenant` (ou le début de la prochaine fenêtre si on est hors plage, avec la mention « partira à 08:00 demain ») ; le prochain `reminders.dispatch` (≤ 5 min) les met en file et un toast « 8 relances envoyées » s'affiche.
- Étant donné une relance dont la facture a été payée entre-temps, quand je l'envoie, alors elle est annulée par la revérification (RG-M10-24) et le toast indique « 7 envoyées, 1 annulée : facture déjà réglée ».

**US-M10-03 — En tant qu'ADVISOR, je veux modifier, reporter ou ignorer une relance afin d'adapter au cas réel.**
- Modifier : Étant donné une relance créance, quand je change le texte et enregistre, alors `renderedBody` est remplacé, `editedBody = true`, l'aperçu montre « Modifié par Awa K. ».
- Reporter : quand je choisis « Reporter au 25/10/2026 », alors `status = SNOOZED`, `snoozedUntil = 2026-10-25` ; le 25/10, `reminders.plan` la remet `NEEDS_APPROVAL` (ou `PLANNED` si auto), sauf si le palier suivant est déjà dû (elle est alors remplacée).
- Ignorer : quand je choisis « Ignorer » avec motif obligatoire (« Client passé ce matin »), alors `status = SKIPPED`, `skippedReason` renseigné ; si je coche « Arrêter toute la séquence », une `ReminderSuppression` est créée sur la clé de séquence et aucun palier suivant ne sera planifié pour cette échéance.

**US-M10-04 — En tant qu'OWNER, je veux que la révision soit calculée sur la date OU le kilométrage (le premier atteint) afin de relancer au bon moment.**
- Étant donné le Hyundai Tucson `8812 JK 01` de Mme Bamba Aminata (dernière révision 14 500 km le 10/04/2026, intervalle 10 000 km / 6 mois, `avgKmPerDay = 70`), quand le worker calcule l'échéance, alors `nextServiceDueMileage = 24 500`, échéance date = 10/10/2026, échéance km projetée = 10/04/2026 + ⌈10 000 / 70⌉ = 143 j → 31/08/2026, donc `nextServiceDueDate = 2026-08-31` (RG-M10-08).

**US-M10-05 — En tant qu'OWNER, je veux qu'un client avec plusieurs véhicules ou plusieurs factures reçoive un seul message afin de ne pas le harceler.**
- Étant donné SOTRA Logistique SARL avec 3 Toyota Hilux dont la VT atteint J-30 le même jour, quand `reminders.dispatch` tourne, alors **un seul** message est envoyé avec le modèle `vt_multi` listant les 3 véhicules, et les 3 `Reminder` portent le même `groupKey` et le même `messageId`.
- Étant donné M. Koné avec 4 factures en retard, alors le dossier de recouvrement (M09) génère **une** relance avec `{{factures.resume}}` = « vos 4 factures (412 000 FCFA au total) ».

**US-M10-06 — En tant qu'OWNER, je veux que les relances s'arrêtent dès que le client a réagi afin de ne pas paraître incompétent.**
- Étant donné une séquence VT en cours pour `2547 GH 01`, quand un `Appointment` est créé pour ce véhicule (événement `appointment.created`), alors tous ses `Reminder` `INSPECTION` et `SERVICE` non envoyés passent `CANCELLED` (« RDV pris le 24/10/2026 ») et une suppression court jusqu'au lendemain du RDV.
- Étant donné un paiement Wave de 185 000 FCFA soldant la facture de M. Koné, quand `payment.received` est consommé, alors les relances `RECEIVABLE` en attente sont annulées et la dernière relance envoyée dans les 7 jours reçoit `outcome = PAID`, `attributedAmount = 185000`.
- Étant donné que M. Traoré répond « STOP », alors une `OptOut` est créée (M11) et toutes ses relances non transactionnelles sont annulées.

**US-M10-07 — En tant que MANAGER, je veux éditer les paliers sur une frise afin d'adapter les règles au garage.**
- Étant donné la frise VT (J-30, J-7, J0, J+7), quand j'ajoute un palier J-3 et enregistre, alors la règle est validée (offsets uniques, au plus 8 paliers), un aperçu d'impact affiche « +14 relances sur les 30 prochains jours » et les séquences en cours intègrent le nouveau palier à partir du prochain passage du planificateur, sans rattrapage rétroactif massif (RG-M10-06).

**US-M10-08 — En tant qu'OWNER d'un garage en mode `REMINDERS_ONLY`, je veux des relances fiables alimentées par l'import afin de garder mon logiciel actuel.**
- Étant donné un garage dont le dernier import des factures date de 72 h (> 48 h), quand des relances de créances sont planifiées, alors elles sont forcées en `NEEDS_APPROVAL` avec le bandeau « Données de créances datées du 15/10/2026 : vérifiez avant d'envoyer » (RG-M10-29).

**US-M10-09 — En tant qu'OWNER, je veux savoir ce que les relances rapportent afin de juger l'outil.**
- Étant donné 120 relances VT envoyées en septembre et 31 RDV ou OR ouverts dans les 30 jours suivants, alors `reminders.stats` renvoie `conversionRate = 25,8 %` et le chiffre d'affaires des OR attribués.

## 4. Règles métier

### 4.1 Types, ancres et règles par défaut

**RG-M10-01 — Ancre de chaque type.** Chaque type de relance calcule une **date d'ancre** ; les paliers sont des décalages (en jours, ou en heures pour `APPOINTMENT`) par rapport à cette ancre.

| Type | Entité | Ancre (`dueDate` du Reminder) | Candidats |
|---|---|---|---|
| `INSPECTION` | Vehicle | `inspectionExpiryDate` | Véhicules non supprimés, ancre ∈ [aujourd'hui − 60 j ; aujourd'hui + 45 j] |
| `SERVICE` | Vehicle | échéance effective (RG-M10-08) | Véhicules avec base de calcul, ancre ∈ [aujourd'hui − 90 j ; aujourd'hui + 30 j] |
| `RECEIVABLE` | CollectionCase (M09) | `CollectionCase.anchorDate` (plus ancienne échéance en retard à l'ouverture du dossier) | Dossiers `OPEN` ou `ESCALATED` |
| `RECEIVABLE` (avant échéance) | Invoice | `Invoice.dueDate` | Factures `ISSUED`/`PARTIALLY_PAID`, client `COMPANY`, `paymentTermsDays > 0` |
| `APPOINTMENT` | Appointment | `startsAt` (date-heure) | RDV `BOOKED`/`CONFIRMED` à venir |
| `QUOTE_FOLLOWUP` | Quote | `sentAt` (paliers J+2, J+5) et `validUntil` (palier « expire ») | Devis `SENT`/`VIEWED` |
| `VEHICLE_READY` | RepairOrder | horodatage du passage en `READY` | OR `READY` non `DELIVERED` |
| `INSURANCE_EXPIRY` | Vehicle | `insuranceExpiryDate` | Ancre ∈ [aujourd'hui ; aujourd'hui + 30 j] |
| `SATISFACTION` | RepairOrder | `deliveredAt` | OR livrés, client sans litige ouvert |

**RG-M10-02 — Règles livrées par défaut** (créées par le seed à la création de l'organisation, modifiables, désactivables). `autoSend` : A = automatique, V = validation.

| Règle | Paliers (`key` : offset · mode · canaux) | Fenêtre | stopOn |
|---|---|---|---|
| Visite technique | `J-30` −30 A · `J-7` −7 A · `J0` 0 A · `J+7` +7 A — canaux WA, SMS | lun-sam 08:00-19:00, préférée 09:00 | `appointment.created`, `vehicle.inspection_updated`, `repair_order.created` |
| Révision | `J-15` −15 A · `J0` 0 A · `J+15` +15 A · `J+45` +45 V — WA, SMS, EMAIL | lun-sam 08:00-19:00, 09:30 | `appointment.created`, `repair_order.created`, `vehicle.service_recorded` |
| Créances | `J+3` courtois A · `J+15` rappel A · `J+30` ferme V · `J+45` alerte gérant (interne) · `J+60` mise en demeure V (OWNER) — WA, SMS, EMAIL | lun-ven 08:30-18:00, 10:00 | `payment.received`, `collection.promised`, `collection.disputed`, `collection.paused` |
| Échéance proche (entreprises) — **inactive par défaut** | `J-3` −3 A — EMAIL, WA | lun-ven, 10:00 | `payment.received` |
| Rendez-vous | `CONFIRM` (à la création) A · `J-1` −1 j à 17:00 A · `H-2` −2 h A (inactif par défaut) — WA, SMS | lun-sam 07:00-20:00 | `appointment.cancelled`, `appointment.updated` (replanifie) |
| Suivi de devis | `J+2` (ancre `sentAt`) A · `J+5` A · `EXPIRE` −1 (ancre `validUntil`) V — WA, SMS | lun-sam 08:00-19:00 | `quote.accepted`, `quote.declined`, `quote.expired` |
| Véhicule prêt | `J0` immédiat A · `J+2` A · `J+5` V — WA, SMS | lun-sam 07:30-19:30 | `repair_order.status_changed` (→ `DELIVERED`) |
| Assurance — **inactive par défaut** | `J-15` A · `J-3` A — WA, SMS | lun-sam, 09:00 | `vehicle.insurance_updated` |
| Satisfaction | `J+2` (ancre `deliveredAt`) A — WA, SMS | lun-sam 10:00-18:00 | — |

**RG-M10-03 — Schéma Zod d'un palier (`ReminderRule.steps[]`).**
```ts
const Step = z.object({
  key: z.string().regex(/^[A-Z0-9+\-_]{1,16}$/),   // "J-30", "J+15", "H-2", "CONFIRM", "EXPIRE"
  label: z.string(),                               // "1er rappel", "Relance ferme", "Alerte gérant"
  offsetDays: z.number().int().min(-365).max(365),
  offsetHours: z.number().int().optional(),        // APPOINTMENT uniquement
  anchor: z.enum(["default","sentAt","validUntil"]).default("default"),
  templateKey: z.string(),                         // "vt_j30"
  autoSend: z.boolean(),
  channels: z.array(z.enum(["WHATSAPP","SMS","EMAIL"])).min(0),
  internalOnly: z.boolean().default(false),        // alerte gérant : pas de message client
  requiresPermission: z.string().optional(),       // "receivable:formal_notice"
  attachments: z.array(z.enum(["statement","formal_notice","invoice"])).default([]),
  catchUpDays: z.number().int().min(0).optional(),
  sendAt: z.string().regex(/^\d\d:\d\d$/).optional(), // heure imposée ("17:00" pour J-1 RDV)
});
```
Contraintes : `key` unique dans la règle ; offsets strictement croissants dans l'ordre affiché ; 1 à 8 paliers ; `internalOnly ⇒ channels = []`.

**RG-M10-04 — `conditions` (JSON) et éligibilité.** Clés reconnues : `customerTypes` (`INDIVIDUAL`/`COMPANY`), `minAmount` (créances, défaut **2 000 FCFA** : on ne relance pas un reliquat d'arrondi), `tags` (inclure), `excludeTags` (défaut `["vip-sans-relance"]`), `siteIds`, `vehicleMinYear`, `digest` (`"monthly"` pour les flottes, RG-M10-17). Un client est **inéligible** si : `deletedAt` non nul, `doNotRemind = true`, `remindersConsent = false` (sauf types transactionnels `APPOINTMENT`, `VEHICLE_READY`), adresse présente dans `OptOut` (même exception), suppression active (RG-M10-21).

### 4.2 Planification

**RG-M10-05 — Clés de séquence et de dédoublonnage.**
- `sequenceKey = "{TYPE}:{entityId}:{anchorISO}"`, ex. `INSPECTION:veh_8k2…:2026-11-02`, `RECEIVABLE:case_3f…:2026-09-10`.
- `dedupeKey = sequenceKey + ":" + stepKey`, ex. `INSPECTION:veh_8k2…:2026-11-02:J-30`. Unicité garantie par `@@unique([organizationId, dedupeKey])` ; insertion par `INSERT … ON CONFLICT DO NOTHING`.
- Si l'ancre change (nouvelle date de VT), la clé change : c'est **une nouvelle séquence**, l'ancienne est annulée (RG-M10-22).
- Relances hors séquence : promesse rompue `RECEIVABLE:{caseId}:{anchor}:PROMISE_BROKEN:{promiseId}`, relance manuelle `…:MANUAL:{yyyyMMddHHmm}`.

**RG-M10-06 — Un seul palier à la fois, rattrapage borné.** À un instant donné, on ne crée que **le palier le plus récent déjà dû** d'une séquence. Les paliers plus anciens non envoyés ne sont jamais rattrapés. Fenêtre de rattrapage d'un palier P de date cible `t(P)` :
- s'il existe un palier suivant N : `[t(P) ; t(N) − minGapDays − 1]` ;
- sinon : `[t(P) ; t(P) + catchUpDays]` (défaut **7 j**).

Exemple (aujourd'hui 18/10/2026, `minGapDays = 3`) :
- M. Kouassi, VT au 02/11 (J-15) importée aujourd'hui : J-30 (cible 03/10) est dû, fenêtre [03/10 ; 26/10 − 4 = 22/10] → **J-30 est créé aujourd'hui** ; le texte dit « expire le 02/11/2026 » (jamais « dans 30 jours », RG-M10-33). J-7 partira le 26/10.
- Mme Yao Adjoua, VT expirée le 12/10 (J+6) : dernier palier dû J0 (cible 12/10), fenêtre [12/10 ; 19/10 − 4 = 15/10] → hors fenêtre, rien aujourd'hui ; **J+7 partira demain 19/10**.
- VT expirée depuis 90 j à l'import : hors candidats (RG-M10-01), aucune relance ; le véhicule apparaît dans « Échéances › Expirées » pour un appel manuel.

**RG-M10-07 — Remplacement et espacement.**
- À la création du palier P, tout `Reminder` de la même séquence en `PLANNED`, `NEEDS_APPROVAL` ou `SNOOZED` d'un palier antérieur passe `CANCELLED` (`skippedReason = "Remplacé par le palier J-7"`, `supersededById`).
- Jamais de palier inférieur ou égal à un palier déjà `SENT`.
- Écart minimal entre deux envois d'une même séquence : `minGapDays` (défaut **3 j**). Si P est dû moins de 3 j après le dernier envoi, `scheduledFor` est repoussé à `dernierEnvoi + 3 j`.

**RG-M10-08 — Échéance de révision (premier atteint).**
```
dateDue  = lastServiceDate + serviceIntervalMonths mois        (si les deux connus)
kmDue    = lastServiceMileage + serviceIntervalKm               (si les deux connus)
kmDate   = refDate + ceil((kmDue − refMileage) / avgKmPerDay)  où (refDate, refMileage) = dernier relevé fiable
nextServiceDueDate    = min(dateDue, kmDate)  (celle qui existe si une seule)
nextServiceDueMileage = kmDue
```
- Intervalles absents sur le véhicule → valeurs de l'organisation `settings.reminders.serviceDefaults` (défaut **6 mois / 10 000 km**, surcharge par carburant possible : diesel 10 000, essence 7 500 au choix du garage).
- Pas de `lastServiceDate` : on prend la date de la dernière facture contenant une opération de catégorie « Entretien » (M08), sinon la dernière visite atelier, sinon **aucune relance** et le véhicule est listé dans « Données incomplètes ».
- `avgKmPerDay` (job `vehicles.estimate_mileage`) : pente entre le premier et le dernier relevé des 365 derniers jours, **au moins 2 relevés espacés de ≥ 30 jours** ; relevés décroissants ignorés (compteur changé ou erreur de saisie) ; valeur bornée à **[5 ; 300] km/j**. Sans valeur fiable : `settings.reminders.defaultKmPerDay` (défaut **40 km/j**, paramétrable) et seule l'échéance date est utilisée si elle existe (on ne relance pas sur une estimation kilométrique non fondée).
- Exemple date d'abord : Mme Bamba avec 45 km/j → kmDate = 10/04 + 223 j = 19/11/2026 ; dateDue = 10/10/2026 → échéance **10/10/2026**.
- Une révision enregistrée (OR livré avec opération « Entretien », ou import avec `lastServiceDate` plus récente) émet `vehicle.service_recorded` → recalcul immédiat → nouvelle ancre → ancienne séquence annulée.

**RG-M10-09 — Créneau d'envoi (`nextSendSlot`).**
- `sendWindow = { days:[1..6], from:"08:00", to:"19:00", preferredTime:"09:00" }` (1 = lundi, ISO). Tout est calculé dans `Organization.timezone` (défaut `Africa/Abidjan`, UTC+0 sans heure d'été) puis stocké en UTC.
- Jour non ouvré = jour absent de `days`, **dimanche par défaut**, ou date dans `settings.reminders.holidays`.
- Palier d'**avant** échéance (offset < 0) tombant un jour non ouvré : on **avance** au jour ouvré précédent s'il n'est pas passé, sinon on recule au suivant. Palier à J0 ou après : on recule au **jour ouvré suivant**.
- Heure : `step.sendAt` sinon `preferredTime` ; si on planifie pour aujourd'hui et que l'heure est passée mais la fenêtre ouverte, envoi au prochain passage de `reminders.dispatch` ; fenêtre fermée → lendemain ouvré à `preferredTime`.
- Exemple : J-7 d'une VT au 08/11/2026 → cible dimanche 01/11/2026 (Toussaint et dimanche) → samedi **31/10/2026 09:00**.

**RG-M10-10 — Jours fériés ivoiriens (pré-remplis, modifiables dans Paramètres › Règles).** Fixes : 1er janvier, 1er mai, 7 août (Fête nationale), 15 août (Assomption), 1er novembre (Toussaint), 15 novembre (Journée nationale de la paix), 25 décembre. Mobiles chrétiens (calculés à partir de Pâques) : lundi de Pâques, Ascension, lundi de Pentecôte. Musulmans (fixés chaque année par décret, **pré-remplis comme « estimés, à confirmer »**) : lendemain de la Nuit du Destin, Korité (Aïd el-Fitr), Tabaski (Aïd el-Kébir), lendemain du Maouloud. Exemple de pré-remplissage 2027 : lundi de Pâques 29/03, Ascension 06/05, lundi de Pentecôte 17/05 ; Korité ≈ 10/03 (estimé), Tabaski ≈ 17/05 (estimé). Le tableau de bord affiche une alerte en décembre : « Confirmez les jours fériés religieux de l'année prochaine ».

### 4.3 Destinataire et canal

**RG-M10-11 — Destinataire.**
- `INDIVIDUAL` : `Customer.whatsappPhone ?? phone`, sinon `phone2`, sinon `email`.
- `COMPANY` : contacts `CustomerContact` avec `receivesReminders = true` (relances véhicules) ou `receivesInvoices = true` (créances) ; à défaut le contact principal du client. Pour un véhicule de flotte, `Vehicle.driverPhone` reçoit **uniquement** `VEHICLE_READY` et `APPOINTMENT` si l'option « prévenir le chauffeur » est active ; jamais une créance.
- Les numéros fixes ivoiriens (préfixes `21`, `25`, `27` après +225) ne reçoivent ni SMS ni WhatsApp (`core/phone.classify` → `FIXED`) : on passe au moyen suivant. Exemple : SOTRA Logistique (+225 27 22 41 55 00) → contact « Comptabilité » ou email.

**RG-M10-12 — Ordre des canaux.** `Customer.preferredChannel` s'il fait partie de `step.channels`, puis l'ordre de `step.channels`, en retirant : WhatsApp si `hasWhatsapp = false` ou canal WhatsApp non configuré (le mode lien `wa.me` reste possible en validation manuelle), SMS si le numéro est fixe ou si le crédit SMS est épuisé, email si absent, tout canal présent dans `OptOut` pour cette adresse. La liste ordonnée est transmise à M11 qui gère le **repli** (WhatsApp → SMS → email). Liste vide → RG-M10-31.

**RG-M10-13 — Choix du modèle.** `MessageTemplate` recherché par `(key, channel)` dans cet ordre : `{templateKey}_pro` si client `COMPANY` ; `{templateKey}` ; pour un envoi groupé véhicules, `vt_multi` / `rev_multi`. WhatsApp hors fenêtre de 24 h : le modèle doit avoir `whatsappStatus = APPROVED` sinon le canal WhatsApp est retiré pour cet envoi (M11).

### 4.4 Regroupement et anti-spam

**RG-M10-14 — Clé de destinataire.** Toutes les règles anti-spam et de regroupement se calculent par **adresse normalisée** (`recipientKey` = téléphone E.164 ou email en minuscules), **pas par `customerId`** : deux fiches en double issues d'un import (même numéro) ne reçoivent jamais deux messages.

**RG-M10-15 — Regroupement.** Au moment de l'envoi, les relances dues sont regroupées par `(recipientKey, type, stepKey)` pour `INSPECTION` et `SERVICE`, et par dossier pour `RECEIVABLE` :
- 1 véhicule → modèle du palier ; ≥ 2 véhicules → modèle `vt_multi`/`rev_multi` avec `{{vehicules.liste}}` ; au-delà de 10 véhicules, la liste est tronquée (« … et 4 autres véhicules, détail sur demande »).
- `groupKey = "{recipientKey}:{type}:{stepKey}:{yyyy-MM-dd}"` ; tous les `Reminder` du groupe partagent le `messageId`.
- VT et révision du **même véhicule** dues le même jour : un seul message `vt_rev_combo` (les deux `Reminder` partagent le message).
- Créances : un dossier = un message, avec `{{factures.resume}}` et `{{client.soldeEnRetard}}` (M09).

**RG-M10-16 — Plafonds et priorités.** Pour les messages non transactionnels : au plus **1 message par jour** et **3 par 7 jours glissants** par `recipientKey` (`settings.reminders.maxPerDay`, `maxPerWeek`). Priorités (1 = plus prioritaire) :

| Priorité | Types |
|---|---|
| 0 (hors plafond) | `APPOINTMENT`, `VEHICLE_READY`, messages transactionnels M11 |
| 1 | `RECEIVABLE` paliers ≥ J+30, `PROMISE_BROKEN` |
| 2 | `INSPECTION` J0 et J+7 |
| 3 | `RECEIVABLE` autres paliers |
| 4 | `INSPECTION` autres, `QUOTE_FOLLOWUP` |
| 5 | `SERVICE` |
| 6 | `INSURANCE_EXPIRY` |
| 7 | `SATISFACTION` |

Si le plafond est atteint, la relance la moins prioritaire est reportée au jour ouvré suivant (`SNOOZED`, motif « Plafond anti-spam ») ; après **3 reports**, elle passe `SKIPPED`. `SATISFACTION` n'est jamais envoyée à un client ayant un dossier de recouvrement `ESCALATED` ou `DISPUTED`, ni le même jour qu'une relance de créance.

**RG-M10-17 — Synthèse mensuelle des flottes (P1).** Règle VT/Révision avec `conditions.digest = "monthly"` et `customerTypes = ["COMPANY"]` : le premier jour ouvré du mois, un message unique par entreprise liste tous les véhicules dont VT ou révision tombe dans les 45 jours (`dedupeKey = "INSPECTION:{customerId}:2026-11:DIGEST"`), avec relevé PDF en email. Les paliers individuels sont alors désactivés pour ces clients, sauf J0 et J+7.

### 4.5 Validation, actions, arrêt

**RG-M10-18 — Mode d'envoi.** `settings.reminders.approvalMode` : `PER_STEP` (défaut, suit `step.autoSend`), `MANUAL_ALL` (tout en validation), `PAUSED` (interrupteur général : plus rien ne part, bandeau rouge partout). **Rodage** : pendant les 14 jours suivant l'activation des relances (ou un import initial M13), `MANUAL_ALL` est imposé avec le bandeau « Période de rodage : vérifiez les relances avant envoi (encore 9 jours) ». Lors de l'activation d'une règle, tous les rattrapages créés au premier passage sont en `NEEDS_APPROVAL`.

**RG-M10-19 — Expiration d'une validation.** Une relance `NEEDS_APPROVAL` non traitée expire (`SKIPPED`, motif « Non traitée à temps ») à `approvalExpiresAt = min(t(palier suivant) − 1 j, t(palier) + 7 j)`. Elle reste visible 7 jours dans l'onglet « Expirées ».

**RG-M10-20 — Actions sur une relance.**

| Action | Statuts de départ | Effet |
|---|---|---|
| Envoyer | `NEEDS_APPROVAL`, `PLANNED`, `FAILED` | `approvedById/At`, → `PLANNED` avec `scheduledFor = now` si fenêtre ouverte (dispatch immédiat demandé à la file) ; hors fenêtre, choix « au prochain créneau » (défaut) ou « maintenant » (confirmation, interdit 21:00-07:00) |
| Modifier | `NEEDS_APPROVAL`, `PLANNED` | `renderedBody`/`renderedSubject` figés, `editedBody = true`, canal modifiable parmi les disponibles |
| Reporter | non envoyée | `SNOOZED`, `snoozedUntil` ≤ veille du palier suivant (sinon proposer d'ignorer) |
| Ignorer | non envoyée | `SKIPPED` + motif (liste : « Client déjà venu », « Déjà payé », « Mauvais numéro », « Client vendu le véhicule », « Autre ») ; option « Arrêter la séquence » |
| Appeler | toute | ouvre `tel:` et la saisie du résultat d'appel (M09 `CollectionNote` pour les créances, note client sinon) |
| Ouvrir dans WhatsApp | non envoyée, mode `wa_link` | ouvre `wa.me` ; au retour, « Avez-vous envoyé ? » → `SENT` (`provider = wa_link`) |

Motif « Déjà payé » sur une créance : crée une tâche pour la caisse « Vérifier et enregistrer le paiement de M. Koné » et pause le dossier 48 h (M09).

**RG-M10-21 — Suppressions.** `ReminderSuppression` (portée : `sequenceKey`, ou `customerId`+`type`, ou `vehicleId`+`type`), avec `until` optionnel. Sources : « RDV pris » (jusqu'à RDV + 1 j), « VT effectuée » (permanente sur l'ancienne ancre), « Arrêter la séquence », litige ou promesse (M09). Le planificateur ne crée aucun `Reminder` couvert par une suppression active.

**RG-M10-22 — Arrêts automatiques (consommateurs d'événements, idempotents par `eventId`).**

| Événement | Effet |
|---|---|
| `appointment.created` (véhicule V ou client sans véhicule précisé) | Annule `INSPECTION`/`SERVICE`/`QUOTE_FOLLOWUP` non envoyés de V ; suppression jusqu'à `startsAt + 1 j` ; `outcome = APPOINTMENT_BOOKED` sur la dernière relance envoyée attribuable |
| `appointment.cancelled` / RDV `NO_SHOW` | Lève la suppression ; la séquence reprend au **palier suivant** (pas de rattrapage) |
| `repair_order.created` (véhicule V) | Comme un RDV (le client est venu sans RDV) ; outcome `VISITED` |
| `vehicle.inspection_updated` | Nouvelle `inspectionExpiryDate` > ancienne : annule l'ancienne séquence (« VT renseignée ») ; nouvelle séquence planifiée normalement |
| `vehicle.service_recorded` | Idem pour `SERVICE` |
| `vehicle.owner_changed` | Annule les relances non envoyées liées au véhicule pour l'ancien propriétaire ; le nouveau propriétaire reprend au palier suivant non envoyé |
| `payment.received` | M09 recalcule le dossier ; dossier soldé → annule ses relances ; partiel → la prochaine relance utilisera le nouveau solde (re-rendu à l'envoi) |
| `collection.promised` / `disputed` / `paused` | Annule les `RECEIVABLE` non envoyées du dossier (M09 gère la reprise) |
| `quote.accepted` / `declined` / `expired` | Annule `QUOTE_FOLLOWUP` ; `outcome = QUOTE_ACCEPTED` si acceptation dans les 7 j d'un envoi |
| `message.inbound_received` STOP | OptOut (M11) → annule tout le non-transactionnel du destinataire, `outcome = OPTED_OUT` |
| `message.inbound_received` (autre) | `outcome = REPLIED` sur la dernière relance envoyée au destinataire (72 h) ; la séquence concernée est suspendue **48 h** (`settings.reminders.pauseOnReplyHours`) pour laisser l'humain répondre |
| `customer.updated` (`doNotRemind`, consentement retiré) | Annule tout le non-transactionnel |

**RG-M10-23 — Liste blanche `stopOn`.** Les valeurs acceptées dans `ReminderRule.stopOn` sont exactement les noms d'événements du tableau RG-M10-22 ; toute autre valeur est rejetée par le validateur Zod.

### 4.6 Envoi sûr

**RG-M10-24 — Revérification juste avant l'envoi** (dans la transaction de `reminders.dispatch`, lignes verrouillées `FOR UPDATE SKIP LOCKED`) :
1. Client : non supprimé, consentement, pas `doNotRemind`, adresse hors `OptOut`, pas de suppression active.
2. `INSPECTION` : `inspectionExpiryDate` toujours égale à l'ancre ; véhicule toujours rattaché au client ; aucun RDV/OR ouvert depuis la planification.
3. `SERVICE` : échéance recalculée identique à ± 3 j ; sinon annulation et nouvelle séquence.
4. `RECEIVABLE` : solde en retard **recalculé maintenant** depuis `Invoice.balance` (pas la valeur en cache) ≥ `minAmount` ; dossier `OPEN`/`ESCALATED` ; pas de paiement `PENDING` (lien de paiement en cours) dans les 2 dernières heures ; pas de paiement non affecté ni d'avoir couvrant le retard (sinon alerte « Paiement non affecté à rapprocher », relance bloquée) ; en `REMINDERS_ONLY`, fraîcheur des données (RG-M10-29).
5. `APPOINTMENT` : RDV toujours `BOOKED`/`CONFIRMED` et `startsAt` inchangé.
6. `QUOTE_FOLLOWUP` : devis toujours `SENT`/`VIEWED`.
7. `VEHICLE_READY` : OR toujours `READY`.
8. Fenêtre d'envoi ouverte et plafonds anti-spam respectés.
Échec 1-7 → `CANCELLED` avec motif lisible ; échec 8 → replanification.

**RG-M10-25 — Re-rendu.** Le texte est **toujours re-rendu à l'envoi** avec les données du moment (`{{client.soldeEnRetard}}`, `{{vt.joursRestants}}`). Si le texte a été modifié manuellement (`editedBody`) et qu'une donnée chiffrée du contexte a changé depuis la modification (solde, date d'échéance), l'envoi est bloqué et la relance revient en `NEEDS_APPROVAL` avec l'alerte « Le solde est passé de 412 000 à 227 000 FCFA depuis votre modification ».

**RG-M10-26 — Idempotence de l'envoi.** M11 reçoit `idempotencyKey = "rem:" + groupKey` ; un rejeu du job ne produit jamais un second message. Un `Reminder` `QUEUED` depuis plus de 30 min sans `Message` correspondant est remis en `PLANNED` par `reminders.dispatch` (récupération après crash).

### 4.7 Résultats et attribution

**RG-M10-27 — Résultats (`ReminderOutcome`).** Calculés par événements (temps réel) et consolidés par `reminders.outcomes` chaque nuit. Fenêtres d'attribution (paramétrables) :

| Type | Résultat | Fenêtre après `sentAt` |
|---|---|---|
| `INSPECTION`, `SERVICE` | `APPOINTMENT_BOOKED` (RDV créé) ou `VISITED` (OR ouvert sans RDV) pour le véhicule | 30 j |
| `RECEIVABLE` | `PAID` / `PARTIALLY_PAID` (paiement affecté aux factures du dossier), `PROMISED` | 7 j (`settings.collections.attributionDays`) |
| `QUOTE_FOLLOWUP` | `QUOTE_ACCEPTED` | 7 j |
| `VEHICLE_READY` | `VEHICLE_PICKED_UP` | 7 j |
| tous | `REPLIED` (réponse entrante), `OPTED_OUT` | 72 h |
| tous | `NO_RESPONSE` | à l'expiration de la fenêtre sans autre résultat |

Règle du **dernier contact** : une conversion n'est attribuée qu'à **une seule** relance, la dernière `SENT` avant la conversion dans la fenêtre. Un résultat plus fort remplace un plus faible (`PAID` > `PARTIALLY_PAID` > `PROMISED` > `APPOINTMENT_BOOKED` > `VISITED` > `REPLIED` > `NO_RESPONSE`).
`attributedAmount` (créances) = somme des `PaymentAllocation.amount` vers les factures du dossier, payées dans la fenêtre. `attributedRevenue` (VT/révision) = `total` des factures de l'OR issu du RDV.
Exemple : relance J+15 envoyée le 05/10 à M. Koné ; paiement Wave de 100 000 FCFA le 08/10 puis 85 000 FCFA le 20/10 → `PARTIALLY_PAID`, `attributedAmount = 100 000` (le second paiement est hors fenêtre de 7 j, sauf si une relance plus récente le couvre).

**RG-M10-28 — Indicateurs** (`reminders.stats`, consommés par M12) : envoyés, délivrés, lus, échecs (par canal), taux de conversion par type et par palier, montant récupéré attribué, CA attribué, délai médian envoi → conversion, top motifs d'annulation (révèle les problèmes de données).

### 4.8 Mode « Relances seules » et qualité des données

**RG-M10-29 — `operatingMode = REMINDERS_ONLY`.** Les données viennent de M13 (import Excel/CSV, dossier surveillé, base SQL). Différences :
- Les « événements » sont déduits des différences d'import (`ExternalRef.hash`) : nouvelle date VT → `vehicle.inspection_updated` ; solde de facture diminué → `payment.received` synthétique (`Payment.provider = "import"`) ; nouvelle facture d'entretien → `vehicle.service_recorded`.
- **Fraîcheur** : si le dernier import réussi de l'entité concernée date de plus de `settings.reminders.maxDataAgeHours` (défaut **48 h**), les relances `RECEIVABLE` sont forcées en `NEEDS_APPROVAL` avec bandeau ; au-delà de 7 jours, elles ne sont plus créées et une alerte système s'affiche (« Dernier import il y a 8 jours : relances de créances suspendues »).
- Un paiement saisi dans AtelierOS (« Marquer payé ») est prioritaire : tant que l'import montre un solde **supérieur** au solde local pour une facture marquée payée localement après la date de l'extraction, on garde le solde local et on signale l'écart (« Le logiciel source indique encore 185 000 FCFA dus »).
- Les écrans OR/devis/stock sont masqués ; RDV et « RDV pris » restent disponibles.

**RG-M10-30 — Garde-fous de données.**
- `inspectionExpiryDate` > aujourd'hui + 2 ans, ou `inspectionLastDate` > `inspectionExpiryDate` → données ignorées pour la planification, véhicule marqué « Date de VT suspecte » (inversion jour/mois fréquente à l'import : 02/11 lu 11/02).
- VT sans date d'expiration mais avec `inspectionLastDate` → expiration déduite = dernière VT + validité paramétrable (`settings.reminders.inspectionValidityMonths`, défaut 12 ; 6 pour les véhicules marqués « transport » — à confirmer par le garage selon la réglementation SICTA en vigueur), marquée « estimée » dans l'aperçu.
- VT sans aucune date → aucune relance ; compteur « 37 véhicules sans date de VT » avec action « Demander la date au client » (message `vt_demande_date`, en validation).
- Plaque en double dans l'organisation → le planificateur ignore les deux et lève l'alerte « Véhicule en double : 2547 GH 01 (2 fiches) — fusionner (M02) ».
- Kilométrage jamais relevé → révision sur la date seule (RG-M10-08).

**RG-M10-31 — Client sans canal.** Aucun canal utilisable (pas de mobile, pas d'email, ou tout en `OptOut` sauf transactionnel) → `Reminder` créé en `NEEDS_APPROVAL`, `channel = null`, dans l'onglet « À appeler » avec actions « Appeler » / « Compléter la fiche ». Après saisie d'un numéro mobile, la relance redevient envoyable.

**RG-M10-32 — Numéro invalide.** Après 2 échecs définitifs (numéro inexistant) sur un même numéro, M11 marque le numéro invalide (`Customer.phoneInvalidAt`) ; plus aucun envoi vers ce numéro jusqu'à modification de la fiche ; la relance va dans « À appeler ».

**RG-M10-33 — Rédaction des modèles.** Les modèles n'écrivent jamais de délai relatif figé (« dans 30 jours ») mais la date (`{{vt.dateExpiration}}`) ou la variable calculée à l'envoi (`{{vt.joursRestants}}`). Ils ne menacent jamais au-delà de ce que le garage fera réellement ; la mise en demeure est le seul message à caractère juridique et exige la validation de l'OWNER.

## 5. Machine à états

### 5.1 `Reminder.status`

```
          plan()                          approve / auto
  ┌──────► PLANNED ──────dispatch()──────────────┐
  │          ▲ │ (autoSend=false ou rodage)         ▼
  │  approve │ ▼                                QUEUED ──(M11 SENT)──► SENT
  │     NEEDS_APPROVAL ───────────────────────────── │
  │          │  │                                    └──(tous canaux échoués)──► FAILED ──retry──► QUEUED
  │  snooze  │  └─ignore / expiration──► SKIPPED
  │          ▼
  └──── SNOOZED (jusqu'à snoozedUntil, puis retour PLANNED/NEEDS_APPROVAL)
  Tout statut non envoyé ──(stop event, revérif KO, remplacement)──► CANCELLED
```

| Transition | Déclencheur | Qui | Effets |
|---|---|---|---|
| ∅ → `PLANNED` / `NEEDS_APPROVAL` | `reminders.plan` | Système | `DomainEvent reminder.planned` |
| `NEEDS_APPROVAL` → `PLANNED` (approuvée) | `reminders.approve` | `reminder:approve` (+ `requiresPermission` du palier) | `approvedById/At`, `scheduledFor` = maintenant ou prochain créneau, `AuditLog` si texte modifié |
| `PLANNED` → `QUEUED` | `reminders.dispatch` | Système | Message M11 créé |
| `QUEUED` → `SENT` | `message.status_changed` (SENT) | Système | `sentAt` ; M09 `lastContactAt` |
| `QUEUED` → `FAILED` | tous canaux en échec | Système | Notification à l'ADVISOR, onglet « Échecs » |
| * → `SNOOZED` | `reminders.snooze` ou plafond | Utilisateur / Système | `snoozedUntil` |
| * → `SKIPPED` | `reminders.skip`, expiration, 3 reports | Utilisateur / Système | `skippedReason` obligatoire |
| * → `CANCELLED` | arrêt, revérif, remplacement | Système | `skippedReason`, `supersededById` |

`SENT`, `SKIPPED`, `CANCELLED` sont terminaux. `FAILED` peut être relancé manuellement (une fois le numéro corrigé).

### 5.2 Palier `internalOnly` (alerte gérant J+45)
Création → directement `SENT` (`channel = null`) : crée une `Notification` pour chaque OWNER, ajoute le dossier au résumé quotidien, appelle `collections.escalate` (M09 : `status = ESCALATED`).

## 6. Données

Entités de `02` : `ReminderRule`, `Reminder`, `MessageTemplate`, `Message` (lecture/liaison), `OptOut`, `Customer`, `CustomerContact`, `Vehicle`, `MileageReading`, `VehicleEvent`, `Appointment`, `RepairOrder`, `Quote`, `Invoice`, `PaymentAllocation`, `CollectionCase`, `PaymentPromise`, `ImportJob`, `ExternalRef`, `Notification`, `DomainEvent`, `AuditLog`, `Organization.settings`.

Clés de `Organization.settings.reminders` (JSON, validées par Zod dans `packages/validators/settings.ts`) :
```json
{
  "approvalMode": "PER_STEP",
  "warmupUntil": "2026-11-01",
  "maxPerDay": 1, "maxPerWeek": 3, "minGapDays": 3, "catchUpDays": 7,
  "pauseOnReplyHours": 48, "maxDataAgeHours": 48,
  "defaultKmPerDay": 40, "serviceDefaults": { "months": 6, "km": 10000 },
  "inspectionValidityMonths": 12,
  "holidays": [{ "date": "2026-11-01", "label": "Toussaint", "estimated": false }],
  "attributionDays": { "INSPECTION": 30, "SERVICE": 30, "RECEIVABLE": 7, "QUOTE_FOLLOWUP": 7 }
}
```
Champs et énumérations supplémentaires : voir §14.

## 7. Écrans et interface

### 7.1 Relances du jour — `/relances`
- **Bandeau de mode** : « Les relances VT et révision partent automatiquement à 09:00. Les créances fermes attendent votre validation. » ; en rodage : orange ; en pause : rouge avec bouton « Reprendre les envois » (OWNER).
- **Onglets** avec compteurs : À valider · Planifiées aujourd'hui · Envoyées aujourd'hui · Échecs · À appeler · Expirées. Filtres : type (Tout, VT, Révision, Créance, RDV, Devis, Véhicule prêt, Assurance, Satisfaction), canal, site, palier, conseiller.
- **Carte / ligne** : pastille de type, client (+ badge Particulier/Entreprise), véhicule(s) « Toyota Corolla · 2547 GH 01 », motif (« VT expire le 02/11/2026 (J-15) », « 4 factures — 412 000 FCFA, retard 38 j »), badge de palier (« 1er rappel », « Relance ferme »), canal prévu modifiable, heure prévue, aperçu dépliable (bulle WhatsApp / SMS avec compteur / email), mention « Groupé : 3 véhicules », mention « Rattrapage » si créé hors date cible.
- **Actions** : Envoyer, Modifier, Reporter (calendrier, raccourcis +1 j, +3 j, lundi), Ignorer (motif), Appeler, Ouvrir dans WhatsApp (mode lien), Voir le client.
- **Sélection multiple** + « Envoyer la sélection » (accent orange) → modale récapitulative par canal et coût estimé si disponible (M11).
- **États** : vide « Aucune relance aujourd'hui. Tout est à jour. » ; chargement en squelettes ; erreur réseau avec « Réessayer ».
- **Mobile** : cartes empilées, actions par balayage (droite = envoyer, gauche = reporter), barre d'action collante en sélection.

### 7.2 Échéances — `/relances/echeances`
Onglets **Visite technique** · **Révision** · **Assurance** ; vues **liste** et **calendrier mensuel** (points colorés par jour, clic = liste du jour).
- VT : véhicule, plaque, client, dernière VT, expiration, compte à rebours (« J-15 », « Expirée depuis 6 j »), statut de séquence (« J-30 envoyé le 03/10, lu »), prochaine relance.
- Révision : dernière révision (date + km), échéance date, échéance km, km estimé du jour, barre de progression km, base de calcul (« km estimé, 70 km/j »).
- Filtres : sous 7 j, sous 30 j, expirée, à venir, **données incomplètes**, **date suspecte**.
- Actions : « RDV pris » (crée un RDV M03 ou une suppression simple), « VT effectuée » (saisie nouvelle date d'expiration, défaut +12 mois), « Révision faite » (date + km), « Demander la date au client ».

### 7.3 Règles de relance — `/parametres/relances`
- Une carte par règle avec interrupteur actif/inactif.
- **Frise chronologique éditable** : axe centré sur l'échéance (J0), paliers en pastilles déplaçables (pas d'un jour), clic = panneau latéral (libellé, modèle, auto/validation, canaux ordonnés par glisser, heure imposée, pièces jointes). Bouton « + Ajouter un palier ».
- Fenêtre d'envoi : jours (cases), plage horaire, heure préférée ; conditions (types de client, montant minimum, étiquettes).
- **Aperçu d'impact** (calcul à blanc, `reminderRules.simulate`) : « Sur les 30 prochains jours : 112 relances (VT 64, Révision 48), dont 14 groupées. 9 clients sans canal. »
- Section globale : mode (Par palier / Tout valider / Pause), plafonds anti-spam, jours fériés (liste éditable, badge « estimé »), fraîcheur des données.

### 7.4 Fiche client / véhicule (contributions)
Bloc « Relances » : séquences en cours, prochain envoi, historique avec statuts et résultats, bouton « Ne plus relancer » (motif), « Relancer maintenant » (choix du type, crée un `MANUAL`).

## 8. API

Routeur tRPC `reminders` (`apps/web/server/routers/reminders.ts`) :

| Procédure | Entrée | Sortie |
|---|---|---|
| `reminders.queue` | `{ tab, types?, channels?, siteId?, cursor?, limit≤100 }` | `{ items: ReminderCard[], counts: Record<tab,int>, nextCursor }` |
| `reminders.get` | `{ id }` | Reminder + aperçu rendu par canal + historique séquence |
| `reminders.preview` | `{ id, channel }` | `{ body, subject?, sms: { chars, segments, encoding } }` |
| `reminders.approve` | `{ ids: string[] (≤200), sendNow?: boolean }` | `{ queued: n, scheduled: n, cancelled: [{id, reason}] }` |
| `reminders.update` | `{ id, body?, subject?, channel? }` | Reminder |
| `reminders.snooze` | `{ ids, until: date }` | `{ updated: n }` |
| `reminders.skip` | `{ ids, reason, stopSequence?: boolean }` | `{ updated: n }` |
| `reminders.retry` | `{ id }` | Reminder |
| `reminders.createManual` | `{ customerId, type, vehicleId?, caseId?, templateKey?, body?, channel? }` | Reminder (`stepKey = "MANUAL"`) |
| `reminders.markWaLinkSent` | `{ id }` | Reminder |
| `reminders.dueDates` | `{ kind: "INSPECTION"|"SERVICE"|"INSURANCE", filter, month?, cursor? }` | lignes d'échéances |
| `reminders.markAppointmentTaken` | `{ vehicleId, date?, createAppointment: boolean }` | suppression / RDV |
| `reminders.markInspectionDone` | `{ vehicleId, expiryDate, lastDate?, center? }` | Vehicle |
| `reminders.stats` | `{ from, to, siteId? }` | indicateurs RG-M10-28 |
| `reminderRules.list` / `get` | — / `{ id }` | ReminderRule[] |
| `reminderRules.upsert` | ReminderRule (Zod) | ReminderRule |
| `reminderRules.toggle` | `{ id, isActive }` | ReminderRule |
| `reminderRules.simulate` | `{ rule (brouillon), days: 30 }` | `{ total, byStep, grouped, noChannel, sample: ReminderCard[10] }` |
| `reminderSettings.get` / `update` | settings.reminders | settings.reminders |

API REST publique (M13) : `GET /api/v1/reminders?status=&from=` (lecture), `POST /api/v1/vehicles/{id}/inspection` (mise à jour VT depuis le logiciel existant), `POST /api/v1/appointments` déclenche les arrêts.

## 9. Automatisations et événements

### 9.1 Job `reminders.plan` (horaire, verrou par organisation)

```ts
async function planReminders(org: Org, now: Date) {
  const cfg = loadReminderSettings(org);
  if (cfg.approvalMode === "PAUSED") return;
  const today = toZonedDate(now, org.timezone);              // date locale
  reactivateSnoozed(org, today);                              // SNOOZED dont snoozedUntil <= today
  expireApprovals(org, now);                                  // RG-M10-19
  for (const rule of activeRules(org)) {
    for (const cand of candidates(rule.type, org, today)) {   // RG-M10-01 (requêtes indexées, par lots de 500)
      if (!isEligible(cand, rule.conditions, cfg)) continue;  // RG-M10-04
      if (dataSuspect(cand)) { flagDataQuality(cand); continue; } // RG-M10-30
      const anchor = cand.anchorDate;
      const seqKey = `${rule.type}:${cand.entityId}:${iso(anchor)}`;
      if (await isSuppressed(seqKey, cand)) continue;         // RG-M10-21
      const history = await remindersBySequence(seqKey);
      const pick = pickStep(rule.steps, anchor, today, history, cfg);
      if (!pick) continue;
      await db.$transaction(async (tx) => {
        const created = await tx.reminder.createIfAbsent({     // ON CONFLICT (organizationId, dedupeKey) DO NOTHING
          dedupeKey: `${seqKey}:${pick.step.key}`, sequenceKey: seqKey,
          ruleId: rule.id, type: rule.type, stepKey: pick.step.key,
          customerId: cand.customerId, vehicleId: cand.vehicleId, invoiceId: cand.invoiceId,
          appointmentId: cand.appointmentId, quoteId: cand.quoteId,
          dueDate: anchor, priority: priorityOf(rule.type, pick.step),
          scheduledFor: nextSendSlot(pick.notBefore ?? targetDate(anchor, pick.step),
                                     rule.sendWindow, pick.step, cfg.holidays, org.timezone),
          status: initialStatus(pick, cfg, org),               // RG-M10-18, RG-M10-29
          approvalExpiresAt: approvalExpiry(rule.steps, anchor, pick.step),
        });
        if (created) {
          await supersedeOlder(tx, history, pick.step, created.id); // RG-M10-07
          if (pick.step.internalOnly) await runInternalStep(tx, created); // alerte gérant
          await emit(tx, "reminder.planned", { reminderId: created.id });
        }
      });
    }
  }
}

function pickStep(steps, anchor, today, history, cfg) {
  const sorted = [...steps].sort(byOffset);
  const due = sorted.filter(s => targetDate(anchor, s) <= today);
  if (due.length === 0) return null;
  const step = due[due.length - 1];                          // seul le plus récent
  if (history.some(r => r.stepKey === step.key)) return null; // déjà créé (quel que soit le statut)
  const lastSent = maxBy(history.filter(r => r.status === "SENT"), r => r.sentAt);
  if (lastSent && indexOf(sorted, lastSent.stepKey) >= indexOf(sorted, step.key)) return null;
  const next = sorted[indexOf(sorted, step.key) + 1];
  const limit = next ? addDays(targetDate(anchor, next), -cfg.minGapDays - 1)
                     : addDays(targetDate(anchor, step), step.catchUpDays ?? cfg.catchUpDays);
  if (today > limit) return null;                            // trop tard : on attend le palier suivant
  const notBefore = lastSent && diffDays(today, lastSent.sentAt) < cfg.minGapDays
                    ? addDays(lastSent.sentAt, cfg.minGapDays) : undefined;
  return { step, notBefore, catchUp: targetDate(anchor, step) < today };
}

function initialStatus(pick, cfg, org) {
  if (pick.step.internalOnly) return "SENT";
  if (cfg.approvalMode === "MANUAL_ALL" || inWarmup(cfg)) return "NEEDS_APPROVAL";
  if (pick.catchUp && isFirstRunOfRule(pick)) return "NEEDS_APPROVAL";
  if (pick.step.requiresPermission) return "NEEDS_APPROVAL";
  if (org.operatingMode === "REMINDERS_ONLY" && isReceivable(pick) && dataAgeHours(org) > cfg.maxDataAgeHours)
    return "NEEDS_APPROVAL";
  return pick.step.autoSend ? "PLANNED" : "NEEDS_APPROVAL";
}
```
`APPOINTMENT` : planification aussi déclenchée immédiatement par `appointment.created/updated` (pas d'attente du passage horaire) ; `CONFIRM` est `scheduledFor = now`. `VEHICLE_READY` `J0` : déclenché par `repair_order.status_changed → READY`.

### 9.2 Job `reminders.dispatch` (toutes les 5 min, verrou par organisation)

```ts
async function dispatch(org: Org, now: Date) {
  recoverStuckQueued(org, now);                               // RG-M10-26
  const due = await db.reminder.findMany({ where: { status: "PLANNED", scheduledFor: { lte: now } },
      orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }], take: 500 });
  // une relance validée par un humain est PLANNED avec approvedAt non nul
  const groups = groupBy(due, r => groupKeyOf(r));            // RG-M10-14/15
  for (const g of groups) {
    await db.$transaction(async (tx) => {
      const rows = await lockForUpdateSkipLocked(tx, g.ids);
      const valid = [];
      for (const r of rows) {
        const check = await revalidate(tx, r, now);           // RG-M10-24
        if (check.ok) valid.push(r);
        else if (check.retryAt) await reschedule(tx, r, check.retryAt, check.reason);
        else await cancel(tx, r, check.reason);
      }
      if (valid.length === 0) return;
      const recipient = resolveRecipient(valid[0]);           // RG-M10-11
      const channels = resolveChannels(recipient, stepOf(valid[0]), org); // RG-M10-12
      if (channels.length === 0) return toCallList(tx, valid); // RG-M10-31
      if (!antiSpamAllows(tx, recipient.key, valid[0].priority, now)) return deferForCap(tx, valid);
      const ctx = await buildContext(tx, valid);              // données fraîches (RG-M10-25)
      const edited = valid.find(r => r.editedBody);
      if (edited && materialChange(edited, ctx)) return backToApproval(tx, edited, ctx);
      const msg = await messaging.enqueue(tx, {               // M11
        idempotencyKey: `rem:${groupKeyOf(valid[0])}`, customerId: recipient.customerId,
        to: recipient, channels, templateKey: templateKeyFor(valid, recipient),
        context: ctx, bodyOverride: edited?.renderedBody, attachments: attachmentsFor(valid),
        reminderIds: valid.map(r => r.id), kind: "reminder",
      });
      await tx.reminder.updateMany({ where: { id: { in: valid.map(r => r.id) } },
        data: { status: "QUEUED", messageId: msg.id, groupKey: groupKeyOf(valid[0]), channel: channels[0] } });
    });
  }
}
```
Le passage `QUEUED → SENT/FAILED` est fait par le consommateur de `message.status_changed` (M11).

### 9.3 Autres jobs et événements

| Job / consommateur | Fréquence | Rôle |
|---|---|---|
| `reminders.plan` | horaire | §9.1 |
| `reminders.dispatch` | 5 min | §9.2 |
| `reminders.outcomes` | quotidien 03:30 | Consolide `outcome`, `NO_RESPONSE`, attribution (RG-M10-27) |
| `vehicles.estimate_mileage` | quotidien 02:00 | `avgKmPerDay`, `estimatedMileage`, `nextServiceDue*` (RG-M10-08) |
| `reminders.on_event` | file `events` | Arrêts RG-M10-22, idempotents par `eventId` |
| `reminders.data_quality` | quotidien 04:00 | Compteurs : sans date VT, dates suspectes, doublons de plaques, sans canal |

Événements émis : `reminder.planned`, `reminder.approved`, `reminder.sent`, `reminder.failed`, `reminder.cancelled`, `reminder.outcome_recorded` (M12, M09).

## 10. Permissions

| Action | Permission | OWNER | MANAGER | ADVISOR | ACCOUNTANT | CASHIER |
|---|---|:-:|:-:|:-:|:-:|:-:|
| Voir la file et les échéances | `reminder:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Envoyer / modifier / reporter / ignorer (VT, révision, RDV, devis, prêt, assurance, satisfaction) | `reminder:approve` | ✅ | ✅ | ✅ | — | — |
| Idem pour les créances | `reminder:approve` + `receivable:collect` | ✅ | ✅ | — | ✅ | ✅ (paliers < J+30) |
| Valider une mise en demeure | `receivable:formal_notice` | ✅ | — | — | — | — |
| Modifier les règles et réglages | `reminder:rules` | ✅ | ✅ | — | — | — |
| Mettre en pause / reprendre tous les envois | `reminder:pause` | ✅ | ✅ | — | — | — |
| Voir les résultats | `reminder:stats` | ✅ | ✅ | — | ✅ | — |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Facture payée entre planification et envoi | Revérification RG-M10-24 → `CANCELLED` « Facture déjà réglée le 17/10/2026 » ; aucun message |
| Paiement Wave en cours (lien ouvert, webhook pas encore reçu) | Relance repoussée de 2 h |
| Le client dit « j'ai payé » par WhatsApp | M11/M17 classe l'intention ; dossier en pause 48 h ; tâche caisse « Vérifier le paiement » |
| Double import (même client deux fois) | Regroupement et plafonds par `recipientKey` : un seul message ; alerte doublon (M02) |
| Même fichier importé deux fois | `ExternalRef.hash` inchangé → aucun événement ; `dedupeKey` empêche tout doublon |
| Changement de propriétaire du véhicule | RG-M10-22 ; jamais de relance VT au vendeur après `vehicle.owner_changed` |
| Client sans téléphone / numéro fixe | Email sinon onglet « À appeler » |
| VT sans date / km jamais relevé | RG-M10-30 / révision sur la date seule |
| Règle modifiée en cours de séquence | Les paliers déjà envoyés restent ; nouveau palier pris en compte au passage suivant ; pas de rattrapage massif (fenêtre RG-M10-06) |
| Changement de fuseau de l'organisation | `scheduledFor` des relances non envoyées recalculé |
| Panne du worker 2 jours | Au redémarrage : un seul palier par séquence (RG-M10-06), plafonds actifs ; pas d'avalanche |
| Fournisseur WhatsApp en panne | Repli SMS (M11) ; si tous les canaux échouent : `FAILED`, alerte système |
| Panne prolongée d'un canal + validation massive | Envoi lissé par M11 (limitation de débit) ; la modale avertit « Canal SMS en erreur : 12 messages partiront par email » |
| Client qui répond avec colère | Réponse → pause 48 h de la séquence (RG-M10-22) ; conversation assignée au conseiller |
| Relance d'une entreprise un samedi | Fenêtre créances lun-ven par défaut |
| Mise en demeure sans adresse email | Génération PDF à imprimer ; le palier reste `NEEDS_APPROVAL` avec action « Marquer remise en main propre » |
| Utilisateur sans permission tente d'approuver | `FORBIDDEN` « Vous n'avez pas le droit de valider les relances de créances. » |
| Approbation d'une relance déjà annulée par un autre utilisateur | Ignorée, retour `cancelled: [{ id, reason: "Déjà traitée par Awa K." }]` |

## 12. Tests

**Unitaires `packages/core/reminders`** :
- `pickStep` : palier unique, rattrapage dans/hors fenêtre (cas Kouassi et Yao ci-dessus), jamais de palier inférieur à un envoyé, `minGapDays`, dernier palier + `catchUpDays`.
- `nextSendSlot` : dimanche, 1er novembre, palier négatif avancé, J0 reculé, heure passée, fuseau autre que UTC.
- `computeServiceDue` : date d'abord, km d'abord, sans relevé fiable, relevé décroissant, bornes [5 ; 300].
- `easterBasedHolidays(2027)` = 29/03, 06/05, 17/05.
- `groupReminders` : 3 véhicules → 1 groupe ; deux fiches même téléphone → 1 groupe ; VT + révision même véhicule → combo.
- `antiSpam` : 4e message de la semaine reporté ; priorités ; `SKIPPED` après 3 reports.
- `attribute` : dernier contact, fenêtre 7 j, résultat plus fort remplace le plus faible.
- `revalidate` : chaque motif d'annulation de RG-M10-24.

**Intégration (Postgres de test)** : `reminders.plan` exécuté deux fois → aucune ligne en double ; deux workers en parallèle → un seul message (verrou + `SKIP LOCKED` + `idempotencyKey`) ; événement `payment.received` rejoué deux fois → idempotent ; isolement multi-locataire.

**E2E Playwright** : seed « Garage Excellence Auto » avec les 6 clients du brief ; avancer l'horloge au 18/10/2026 09:00 ; ouvrir `/relances` ; filtrer « Créance » ; modifier le message de M. Koné ; sélectionner 8 ; « Envoyer la sélection » ; vérifier `/dev/outbox` (8 messages, un seul pour SOTRA) ; enregistrer un paiement Wave 185 000 FCFA → la relance planifiée suivante de M. Koné disparaît ; régler la frise VT (ajout J-3) → l'aperçu d'impact se met à jour.

## 13. Définition de « terminé »

- [ ] 8 règles par défaut créées au seed, avec les modèles de l'annexe A pour chaque canal.
- [ ] `reminders.plan`, `reminders.dispatch`, `reminders.outcomes`, `vehicles.estimate_mileage` déployés, verrouillés par organisation, rejouables sans doublon.
- [ ] Revérification avant envoi couverte par un test par motif.
- [ ] Regroupement par destinataire et plafonds anti-spam actifs et testés.
- [ ] File « Relances du jour » complète (desktop + mobile), actions unitaires et groupées, mode lien WhatsApp.
- [ ] Frise de règles éditable avec aperçu d'impact.
- [ ] Mode rodage et interrupteur de pause.
- [ ] Mode `REMINDERS_ONLY` avec garde-fou de fraîcheur.
- [ ] Jours fériés pré-remplis pour l'année en cours et la suivante.
- [ ] Indicateurs exposés à M12 ; E2E vert ; `pnpm test` vert sur `core/reminders` (couverture ≥ 90 %).

## Annexe A — Modèles par défaut livrés

Règles de rédaction : vouvoiement ; `{{garage.nom}}` en tête des SMS (l'expéditeur alphanumérique n'est pas toujours affiché) ; SMS en **GSM-7** (pas de ê â î ô û ç ë ï œ « » ’ ; é è à ù autorisés) et ≤ 160 caractères avec des valeurs typiques (nom de garage ≤ 22 car.) — le compteur de l'éditeur (M11) signale tout dépassement ; un SMS n'invite pas à « répondre » car l'expéditeur alphanumérique ne reçoit pas de réponse. WhatsApp : catégorie Meta indicative (Meta peut reclasser ; M11 gère). Email : le corps ci-dessous est inséré dans la mise en page React Email commune (logo, coordonnées du garage, pied « Ne plus recevoir de rappels »).

### A.1 Visite technique

**`vt_j30`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. {{garage.nom}} vous propose une pré-visite pour passer le contrôle sans surprise. Répondez à ce message ou appelez le {{garage.telephone}} pour réserver.

SMS : `{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. Pre-visite: {{garage.telephone}}`

Email — Objet : `Visite technique de votre {{vehicule.marque}} {{vehicule.modele}} : expiration le {{vt.dateExpiration}}`
> Bonjour {{client.salutation}},
> La visite technique de votre {{vehicule.marque}} {{vehicule.modele}} immatriculé {{vehicule.plaque}} expire le {{vt.dateExpiration}}.
> Nous vous proposons une pré-visite : nous contrôlons les points vérifiés au centre (freins, éclairage, pneus, émissions) et corrigeons ce qui doit l'être, pour réussir la visite du premier coup.
> Prenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}
> {{garage.nom}} — {{garage.adresse}} — {{garage.horaires}}

**`vt_j7`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, plus que {{vt.joursRestants}} jours : la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. Nous pouvons vous recevoir cette semaine pour la pré-visite. Quel jour vous arrange ? {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. RDV cette semaine: {{garage.telephone}}`

Email — Objet : `Plus que {{vt.joursRestants}} jours avant l'expiration de votre visite technique`
> Bonjour {{client.salutation}},
> La visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}, dans {{vt.joursRestants}} jours.
> Nous pouvons encore vous recevoir cette semaine pour une pré-visite. Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}
> {{garage.nom}}

**`vt_j0`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire aujourd'hui, le {{vt.dateExpiration}}. Si ce n'est pas encore fait, passez nous voir : nous vous aidons à la faire rapidement. {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire aujourd'hui. Passez nous voir. Tel {{garage.telephone}}`

Email — Objet : `Votre visite technique expire aujourd'hui`
> Bonjour {{client.salutation}},
> La visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire aujourd'hui. Si vous l'avez déjà faite, ignorez ce message ou indiquez-nous la nouvelle date pour mettre votre dossier à jour.
> Sinon, contactez-nous au {{garage.telephone}} : nous préparons votre véhicule en priorité.
> {{garage.nom}}

**`vt_j+7`** (clé `vt_jp7`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, selon nos informations la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}. Si elle a été faite, envoyez-nous simplement la nouvelle date. Sinon, nous pouvons préparer votre véhicule rapidement : {{garage.telephone}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} a expiré le {{vt.dateExpiration}}. On vous aide: {{garage.telephone}}`

Email — Objet : `Visite technique expirée : on vous aide à régulariser`
> Bonjour {{client.salutation}},
> D'après notre suivi, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}.
> Si elle a déjà été faite, répondez à cet email avec la nouvelle date d'expiration : nous mettrons votre dossier à jour et vous ne recevrez plus ce rappel.
> Sinon, nous pouvons préparer votre véhicule rapidement. Appelez le {{garage.telephone}}.
> {{garage.nom}}

**`vt_multi`** (tous paliers, ≥ 2 véhicules) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos véhicules arrive à échéance :
> {{vehicules.liste}}
> {{garage.nom}} peut organiser les pré-visites en une seule fois. Répondez à ce message ou appelez le {{garage.telephone}}.

SMS : `{{garage.nom}}: {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos vehicules arrive a echeance. Detail et RDV: {{garage.telephone}}`

Email — Objet : `Visites techniques à prévoir : {{vehicules.nombre}} véhicules`
> Bonjour {{client.salutation}},
> Les visites techniques suivantes arrivent à échéance :
> {{vehicules.liste}}
> Nous pouvons regrouper les pré-visites sur une même journée pour limiter l'immobilisation de votre flotte. Contactez-nous au {{garage.telephone}}.
> {{garage.nom}}

`{{vehicules.liste}}` rend une ligne par véhicule : « • Toyota Hilux 3315 KL 01 : expire le 05/11/2026 ».

**`vt_demande_date`** (en validation, déclenché depuis Échéances) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, pour vous rappeler à temps la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}), pouvez-vous nous indiquer sa date d'expiration (ou envoyer une photo de la vignette) ? Merci. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, quelle est la date d'expiration de la visite technique de votre {{vehicule.plaque}}? Merci de nous appeler au {{garage.telephone}}`

### A.2 Révision

**`rev_j-15`** (clé `rev_jm15`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, d'après notre suivi, la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) est à prévoir vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (estimation actuelle : {{vehicule.kmEstime}} km). Souhaitez-vous réserver un créneau ? {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} est a prevoir vers le {{revision.dateEcheance}}. RDV: {{garage.telephone}}`

Email — Objet : `Votre {{vehicule.marque}} {{vehicule.modele}} approche de sa révision`
> Bonjour {{client.salutation}},
> D'après notre suivi, votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) approche de sa révision : échéance vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (nous estimons votre compteur à {{vehicule.kmEstime}} km).
> Une révision régulière (vidange, filtres, contrôle des freins et des niveaux) évite les pannes coûteuses et préserve la valeur de votre véhicule.
> Prenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}
> {{garage.nom}}

**`rev_j0`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est arrivé à l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine, comptez environ une demi-journée. Quel jour vous convient ? {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est due pour sa revision. Reservez au {{garage.telephone}}`

Email — Objet : `C'est le moment de la révision de votre {{vehicule.marque}}`
> Bonjour {{client.salutation}},
> Votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a atteint l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine.
> Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}
> {{garage.nom}}

**`rev_j+15`** (clé `rev_jp15`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Rouler avec une huile usée use le moteur plus vite. Si elle a été faite ailleurs, dites-le-nous et nous mettrons votre suivi à jour. {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} etait prevue le {{revision.dateEcheance}}. RDV: {{garage.telephone}}`

Email — Objet : `Révision en retard sur votre {{vehicule.marque}}`
> Bonjour {{client.salutation}},
> La révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Si elle a été faite, répondez-nous avec la date et le kilométrage pour que nous mettions votre suivi à jour.
> Sinon, contactez-nous au {{garage.telephone}}.
> {{garage.nom}}

**`rev_j+45`** (clé `rev_jp45`, en validation) — WhatsApp (MARKETING probable) :
> Bonjour {{client.salutation}}, dernier petit rappel de {{garage.nom}} : la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) reste à faire. Nous restons à votre disposition au {{garage.telephone}}. Bonne route !

SMS : `{{garage.nom}}: {{client.salutation}}, dernier rappel pour la revision de votre {{vehicule.marque}} {{vehicule.plaque}}. RDV au {{garage.telephone}}`

Email — Objet : `Dernier rappel : révision de votre {{vehicule.marque}}`
> Bonjour {{client.salutation}},
> Dernier rappel : la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) reste à faire. Nous ne vous relancerons plus pour cette échéance.
> {{garage.nom}} — {{garage.telephone}}

**`rev_multi`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, {{vehicules.nombre}} de vos véhicules arrivent à l'échéance de leur révision :
> {{vehicules.liste}}
> Nous pouvons les planifier sur une même journée. Répondez à ce message ou appelez le {{garage.telephone}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, {{vehicules.nombre}} de vos vehicules sont dus pour leur revision. Planning: {{garage.telephone}}`

Email — Objet : `Révisions à planifier : {{vehicules.nombre}} véhicules`
> Bonjour {{client.salutation}},
> Les véhicules suivants arrivent à l'échéance de leur révision :
> {{vehicules.liste}}
> Contactez-nous au {{garage.telephone}} pour les planifier ensemble.
> {{garage.nom}}

(`{{vehicules.liste}}` pour la révision : « • Isuzu D-Max 7741 HB 01 : vers le 12/11/2026 ou 60 000 km ».)

**`vt_rev_combo`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, deux échéances pour votre {{vehicule.marque}} ({{vehicule.plaque}}) : la visite technique expire le {{vt.dateExpiration}} et la révision est due. Faites les deux en un seul passage chez {{garage.nom}}. Réservez au {{garage.telephone}}.

SMS : `{{garage.nom}}: {{client.salutation}}, visite technique (exp. {{vt.dateExpiration}}) et revision a faire sur votre {{vehicule.plaque}}. RDV: {{garage.telephone}}`

Email — Objet : `Visite technique et révision : un seul passage`
> Bonjour {{client.salutation}},
> La visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}} et sa révision est due. Nous pouvons faire la révision et la pré-visite en un seul passage.
> Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}
> {{garage.nom}}

### A.3 Créances

Variantes `_pro` pour les clients `COMPANY` (ton administratif, références, interlocuteur comptable). Toutes les relances de créances incluent le moyen de payer.

**`cr_j+3`** (clé `cr_jp3`, courtois) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, sauf erreur de notre part, {{factures.resume}} reste à régler. Vous pouvez payer en un clic par Wave ou Orange Money : {{lien.paiement}}. Si le paiement est déjà fait, merci de nous le signaler et ignorez ce message. Bonne journée ! {{garage.nom}}

SMS : `{{garage.nom}}: bonjour {{client.salutation}}, rappel de paiement pour {{factures.resume}}. Payer: {{lien.paiement}} Merci`

Email — Objet : `Rappel : {{factures.resume}}`
> Bonjour {{client.salutation}},
> Sauf erreur de notre part, le règlement suivant n'a pas encore été enregistré :
> {{factures.detail}}
> Vous pouvez payer en ligne (Wave, Orange Money, MTN MoMo, carte) : {{lien.paiement}} — ou à notre caisse.
> Si vous avez déjà réglé, merci d'ignorer ce message.
> {{garage.nom}} — {{garage.telephone}}

**`cr_jp3_pro`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, nous vous informons que {{factures.resume}} adressée à {{client.nomComplet}} est arrivée à échéance. Le relevé est disponible ici : {{lien.releve}}. Paiement par virement, Wave ou Orange Money : {{lien.paiement}}. Merci de transmettre au service comptable. {{garage.nom}}

SMS : `{{garage.nom}}: {{factures.resume}} est arrivee a echeance. Releve et paiement: {{lien.paiement}} Contact: {{garage.telephone}}`

Email — Objet : `{{client.nomComplet}} — échéance dépassée : {{factures.resume}}`
> Madame, Monsieur,
> Sauf erreur de notre part, les factures suivantes sont arrivées à échéance et restent à régler :
> {{factures.detail}}
> Solde total : {{client.soldeEnRetard}}. Vous trouverez votre relevé de compte ici : {{lien.releve}}
> Règlement par virement bancaire (coordonnées sur facture), Wave, Orange Money ou MTN MoMo : {{lien.paiement}}
> Merci de bien vouloir procéder au règlement ou de nous indiquer la date prévue.
> Service facturation — {{garage.nom}} — {{garage.telephone}}

**`cr_j+15`** (clé `cr_jp15`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, nous n'avons toujours pas reçu le règlement de {{factures.resume}}. Pouvez-vous nous indiquer quand vous pensez payer ? Lien de paiement : {{lien.paiement}}. Merci. {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, nous attendons toujours le reglement de {{factures.resume}}. Payer: {{lien.paiement}}`

Email — Objet : `Deuxième rappel : règlement en attente`
> Bonjour {{client.salutation}},
> Malgré notre précédent rappel, le règlement suivant reste en attente :
> {{factures.detail}}
> Pouvez-vous nous indiquer la date à laquelle vous prévoyez de régler ? Paiement en ligne : {{lien.paiement}}
> {{garage.nom}} — {{garage.telephone}}

**`cr_jp15_pro`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, deuxième rappel de {{garage.nom}} : {{factures.resume}} reste impayé à ce jour ({{client.joursRetardMax}} jours de retard). Merci de nous communiquer la date de mise en paiement. Relevé : {{lien.releve}}

SMS : `{{garage.nom}}: 2e rappel, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de nous donner une date. Tel {{garage.telephone}}`

Email — Objet : `Deuxième rappel — {{client.nomComplet}} — solde {{client.soldeEnRetard}}`
> Madame, Monsieur,
> Nous revenons vers vous au sujet des factures suivantes, toujours impayées à ce jour :
> {{factures.detail}}
> Retard maximal : {{client.joursRetardMax}} jours. Merci de nous communiquer la date de mise en paiement ou, le cas échéant, le motif de blocage (bon de commande, réception, contestation) afin que nous puissions le lever.
> Relevé de compte : {{lien.releve}}
> Service facturation — {{garage.nom}} — {{garage.telephone}}

**`cr_j+30`** (clé `cr_jp30`, ferme, validation) — WhatsApp (UTILITY) :
> {{client.salutation}}, malgré nos rappels, {{factures.resume}} n'est toujours pas réglé ({{client.joursRetardMax}} jours de retard). Nous vous demandons de régulariser sous 7 jours ou de nous appeler au {{garage.telephone}} pour convenir d'un échéancier. Paiement : {{lien.paiement}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de regulariser sous 7 jours: {{lien.paiement}}`

Email — Objet : `Relance : régularisation demandée sous 7 jours`
> {{client.salutation}},
> Malgré nos rappels, le règlement suivant n'a pas été effectué :
> {{factures.detail}}
> Retard : {{client.joursRetardMax}} jours. Nous vous demandons de régulariser cette situation sous 7 jours. Si vous rencontrez une difficulté, appelez-nous au {{garage.telephone}} : nous pouvons convenir d'un échéancier.
> Paiement en ligne : {{lien.paiement}}
> {{garage.nom}}

**`cr_jp30_pro`** — WhatsApp (UTILITY) :
> Madame, Monsieur, malgré nos relances, {{factures.resume}} demeure impayé ({{client.joursRetardMax}} jours de retard). Sans règlement ou proposition d'échéancier sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit. {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: {{factures.resume}} impaye depuis {{client.joursRetardMax}} j. Sans reglement sous 7 j, credit suspendu. Tel {{garage.telephone}}`

Email — Objet : `Relance ferme — {{client.nomComplet}} — {{client.soldeEnRetard}}`
> Madame, Monsieur,
> Malgré nos relances, les factures suivantes demeurent impayées :
> {{factures.detail}}
> Sans règlement ou proposition d'échéancier de votre part sous 7 jours, nous serons contraints de suspendre l'ouverture de nouveaux travaux à crédit pour votre compte.
> Relevé de compte : {{lien.releve}} — Paiement : {{lien.paiement}}
> Direction — {{garage.nom}} — {{garage.telephone}}

**`cr_alerte_gerant`** (J+45, interne, pas de message client) — Notification et ligne du résumé quotidien :
> Créance à traiter : {{client.nomComplet}} doit {{client.soldeEnRetard}} ({{client.nbFacturesOuvertes}} factures, {{client.joursRetardMax}} j de retard). 3 relances sans effet. Appeler le client ou décider d'une mise en demeure.

**`cr_mise_en_demeure`** (J+60, validation OWNER, PDF joint généré par M09) — WhatsApp (UTILITY, document joint) :
> {{client.salutation}}, vous trouverez ci-joint une mise en demeure de {{garage.nom}} concernant {{factures.resume}}. Pour régler ou en discuter, contactez-nous au {{garage.telephone}}.

SMS : `{{garage.nom}}: {{client.salutation}}, une mise en demeure concernant {{factures.resume}} vous a ete adressee. Contact: {{garage.telephone}}`

Email — Objet : `Mise en demeure de payer — {{client.nomComplet}}`
> {{client.salutation}},
> Veuillez trouver ci-joint une mise en demeure de payer la somme de {{client.soldeEnRetard}} au titre des factures listées dans le document.
> Pour toute question ou pour convenir d'un règlement, contactez-nous au {{garage.telephone}}.
> {{garage.nom}}

**`cr_promesse_j0`** (matin de la date promise, inactif par défaut) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, comme convenu, nous attendons aujourd'hui votre paiement de {{promesse.montant}}. Lien de paiement : {{lien.paiement}}. Merci ! {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, comme convenu, paiement de {{promesse.montant}} attendu aujourd'hui. Payer: {{lien.paiement}}`

Email — Objet : `Votre paiement de {{promesse.montant}} prévu aujourd'hui`
> Bonjour {{client.salutation}},
> Comme convenu, nous attendons aujourd'hui votre paiement de {{promesse.montant}}. Payer en ligne : {{lien.paiement}}
> Merci. {{garage.nom}}

**`cr_promesse_rompue`** (lendemain d'une promesse non tenue, M09) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, sauf erreur, le paiement de {{promesse.montant}} prévu le {{promesse.date}} ne nous est pas parvenu. Pouvez-vous régler aujourd'hui ou nous rappeler au {{garage.telephone}} ? Paiement : {{lien.paiement}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, paiement de {{promesse.montant}} prevu le {{promesse.date}} non recu. Payer: {{lien.paiement}}`

Email — Objet : `Paiement prévu le {{promesse.date}} non reçu`
> Bonjour {{client.salutation}},
> Vous nous aviez indiqué un paiement de {{promesse.montant}} pour le {{promesse.date}}. Sauf erreur, nous ne l'avons pas reçu.
> Merci de régler aujourd'hui ({{lien.paiement}}) ou de nous appeler au {{garage.telephone}} pour convenir d'une nouvelle date.
> {{garage.nom}}

**`cr_avant_echeance_pro`** (J-3, entreprises, inactif par défaut) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, pour information, la facture {{facture.numero}} de {{facture.solde}} arrive à échéance le {{facture.echeance}}. Facture : {{lien.facture}} – Paiement : {{lien.paiement}}. {{garage.nom}}

SMS : `{{garage.nom}}: facture {{facture.numero}} ({{facture.solde}}) a regler avant le {{facture.echeance}}. Paiement: {{lien.paiement}}`

Email — Objet : `Échéance le {{facture.echeance}} — facture {{facture.numero}}`
> Madame, Monsieur,
> Pour faciliter votre planification, la facture {{facture.numero}} d'un montant de {{facture.solde}} arrive à échéance le {{facture.echeance}}.
> Facture : {{lien.facture}} — Paiement : {{lien.paiement}}
> Service facturation — {{garage.nom}}

### A.4 Rendez-vous

**`rdv_confirm`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, votre rendez-vous chez {{garage.nom}} est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} ({{vehicule.plaque}}). Adresse : {{garage.adresse}}. Un empêchement ? Répondez à ce message ou appelez le {{garage.telephone}}.

SMS : `{{garage.nom}}: RDV confirme le {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Changement? Tel {{garage.telephone}}`

Email — Objet : `Rendez-vous confirmé le {{rdv.date}} à {{rdv.heure}}`
> Bonjour {{client.salutation}},
> Votre rendez-vous est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}).
> Adresse : {{garage.adresse}}. Pensez à apporter la carte grise et, si possible, votre carnet d'entretien.
> Pour déplacer le rendez-vous : {{garage.telephone}}. {{garage.nom}}

**`rdv_j-1`** (clé `rdv_jm1`, 17:00 la veille) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, petit rappel : nous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Répondez OUI pour confirmer ou appelez le {{garage.telephone}} pour décaler. {{garage.nom}}

SMS : `{{garage.nom}}: rappel, RDV demain {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Tel {{garage.telephone}}`

Email — Objet : `Rappel : rendez-vous demain à {{rdv.heure}}`
> Bonjour {{client.salutation}},
> Nous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Pour décaler : {{garage.telephone}}.
> {{garage.nom}} — {{garage.adresse}}

**`rdv_h-2`** (clé `rdv_hm2`, inactif par défaut) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, nous vous attendons aujourd'hui à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). À tout à l'heure ! {{garage.nom}}

SMS : `{{garage.nom}}: nous vous attendons aujourd'hui a {{rdv.heure}} avec votre {{vehicule.plaque}}. Tel {{garage.telephone}}`

Email : non utilisé (trop tardif).

### A.5 Suivi de devis

**`devis_j+2`** (clé `devis_jp2`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, avez-vous pu consulter le devis {{devis.numero}} ({{devis.montant}}) pour votre {{vehicule.marque}} ? Vous pouvez l'accepter en ligne, ligne par ligne : {{lien.devis}}. Une question ? Répondez ici. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, votre devis {{devis.numero}} ({{devis.montant}}) vous attend: {{lien.devis}} Tel {{garage.telephone}}`

Email — Objet : `Votre devis {{devis.numero}} vous attend`
> Bonjour {{client.salutation}},
> Votre devis {{devis.numero}} d'un montant de {{devis.montant}} pour votre {{vehicule.marque}} {{vehicule.modele}} est disponible ici : {{lien.devis}}
> Vous pouvez accepter tout ou partie des travaux en ligne. Pour toute question : {{garage.telephone}}.
> {{garage.nom}}

**`devis_j+5`** (clé `devis_jp5`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, souhaitez-vous que nous lancions les travaux du devis {{devis.numero}} ? Les points urgents concernent votre sécurité. Accepter en ligne : {{lien.devis}} ou appelez le {{garage.telephone}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, on lance les travaux du devis {{devis.numero}}? Accepter en ligne: {{lien.devis}}`

Email — Objet : `Devis {{devis.numero}} : souhaitez-vous lancer les travaux ?`
> Bonjour {{client.salutation}},
> Nous restons dans l'attente de votre décision sur le devis {{devis.numero}} ({{devis.montant}}). Les points marqués « urgent » concernent votre sécurité.
> Décider en ligne : {{lien.devis}} — ou appelez-nous au {{garage.telephone}}.
> {{garage.nom}}

**`devis_expire`** (veille de `validUntil`, validation) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Après cette date, les prix des pièces pourront changer. Pour le valider : {{lien.devis}}. {{garage.nom}}

SMS : `{{garage.nom}}: le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Pour le valider: {{lien.devis}}`

Email — Objet : `Votre devis {{devis.numero}} expire le {{devis.validite}}`
> Bonjour {{client.salutation}},
> Le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Au-delà, nous devrons actualiser les prix des pièces.
> Valider en ligne : {{lien.devis}}
> {{garage.nom}}

### A.6 Véhicule prêt

**`pret_j0`** — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, bonne nouvelle : votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt ! Montant à régler : {{facture.solde}}. Payez avant de venir pour gagner du temps : {{lien.paiement}}. Nous sommes ouverts {{garage.horaires}}. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est disponible. A regler: {{facture.solde}}. Payer: {{lien.paiement}}`

Email — Objet : `Votre {{vehicule.marque}} est prêt`
> Bonjour {{client.salutation}},
> Les travaux sur votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) sont terminés. Montant à régler : {{facture.solde}}.
> Facture : {{lien.facture}} — Paiement en ligne : {{lien.paiement}}
> Nous vous attendons {{garage.horaires}}. {{garage.nom}} — {{garage.adresse}}

**`pret_j+2`** (clé `pret_jp2`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) vous attend chez {{garage.nom}} depuis 2 jours. Quand pensez-vous passer le récupérer ? {{garage.telephone}}

SMS : `{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} vous attend depuis 2 jours. Tel {{garage.telephone}}`

Email — Objet : `Votre véhicule vous attend`
> Bonjour {{client.salutation}},
> Votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 2 jours. Quand pensez-vous passer ? {{garage.telephone}}
> {{garage.nom}}

**`pret_j+5`** (clé `pret_jp5`, validation ; mention de gardiennage à n'activer que si le garage l'applique et l'a affichée) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement : au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer selon nos conditions. {{garage.nom}} – {{garage.telephone}}

SMS : `{{garage.nom}}: votre {{vehicule.plaque}} est disponible depuis 5 jours. Frais de gardiennage possibles apres 7 jours. Tel {{garage.telephone}}`

Email — Objet : `Votre véhicule est prêt depuis 5 jours`
> Bonjour {{client.salutation}},
> Votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement ; au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer conformément à nos conditions générales.
> {{garage.nom}} — {{garage.telephone}}

### A.7 Assurance

**`assur_j-15`** (clé `assur_jm15`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler pour rouler l'esprit tranquille. {{garage.nom}}

SMS : `{{garage.nom}}: {{client.salutation}}, l'assurance de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler.`

Email — Objet : `Votre assurance auto expire le {{assurance.dateExpiration}}`
> Bonjour {{client.salutation}},
> D'après nos informations, l'assurance de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler auprès de votre assureur.
> {{garage.nom}}

**`assur_j-3`** (clé `assur_jm3`) — WhatsApp (UTILITY) :
> Bonjour {{client.salutation}}, rappel : l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si c'est déjà renouvelé, envoyez-nous la nouvelle date et nous mettrons votre dossier à jour. {{garage.nom}}

SMS : `{{garage.nom}}: rappel, l'assurance de votre {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler avant de rouler.`

Email — Objet : `Rappel : assurance à renouveler avant le {{assurance.dateExpiration}}`
> Bonjour {{client.salutation}},
> L'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si elle est déjà renouvelée, répondez-nous avec la nouvelle date d'échéance.
> {{garage.nom}}

### A.8 Satisfaction

**`satis_j+2`** (clé `satis_jp2`) — WhatsApp (MARKETING probable ; si refusé en UTILITY, envoyer seulement dans la fenêtre de 24 h ou par SMS) :
> Bonjour {{client.salutation}}, merci d'avoir confié votre {{vehicule.marque}} à {{garage.nom}}. Comment s'est passée votre visite ? Notez-nous de 1 à 5 en répondant à ce message, ou donnez votre avis ici : {{lien.avis}}. Votre retour nous aide à progresser.

SMS : `{{garage.nom}}: merci pour votre visite! Donnez votre avis en 1 clic: {{lien.avis}}`

Email — Objet : `Comment s'est passée votre visite chez {{garage.nom}} ?`
> Bonjour {{client.salutation}},
> Merci d'avoir confié votre {{vehicule.marque}} {{vehicule.modele}} à notre atelier. Votre avis compte : il ne prend que 30 secondes.
> {{lien.avis}}
> {{garage.nom}}

Une note de 1 ou 2 reçue en réponse crée une `Notification` au MANAGER (« Client insatisfait : Kouassi Jean-Marc, OR-YOP-2026-00042 ») et assigne la conversation.

## 14. Évolutions du modèle de données

```prisma
model Reminder {
  // … champs existants de 02 …
  sequenceKey        String                 // "INSPECTION:veh_123:2026-11-02" (sans le palier)
  groupKey           String?                // regroupement d'envoi (RG-M10-15)
  messageId          String?                // message M11 portant cette relance (partagé dans un groupe)
  priority           Int       @default(5)  // RG-M10-16
  renderedSubject    String?
  editedBody         Boolean   @default(false)
  editedById         String?
  editedContext      Json?                  // valeurs chiffrées au moment de la modification (RG-M10-25)
  supersededById     String?
  approvalExpiresAt  DateTime?
  deferCount         Int       @default(0)  // reports anti-spam
  isCatchUp          Boolean   @default(false)
  attributedAmount   Int?                   // FCFA récupérés (créances)
  attributedRevenue  Int?                   // CA de l'OR issu de la relance (VT, révision)
  @@index([organizationId, sequenceKey])
  @@index([organizationId, customerId, status])
  @@index([organizationId, groupKey])
}

enum ReminderOutcome {
  APPOINTMENT_BOOKED PAID PARTIALLY_PAID PROMISED REPLIED NO_RESPONSE OPTED_OUT
  VISITED QUOTE_ACCEPTED VEHICLE_PICKED_UP        // ajouts
}

model ReminderSuppression {
  id             String    @id @default(cuid())
  organizationId String
  sequenceKey    String?
  customerId     String?
  vehicleId      String?
  type           ReminderType?
  until          DateTime?                 // null = permanente
  reason         String                    // "RDV pris le 24/10/2026", "VT effectuée", "Litige"
  source         String                    // appointment | inspection_done | staff | collection
  createdById    String?
  createdAt      DateTime  @default(now())
  @@index([organizationId, sequenceKey])
  @@index([organizationId, customerId, type])
  @@index([organizationId, vehicleId, type])
}

model Customer {
  // …
  phoneInvalidAt     DateTime?             // RG-M10-32
}

model Vehicle {
  // …
  serviceDueBasis       String?            // "date" | "km" (laquelle a déterminé l'échéance)
  inspectionExpiryEstimated Boolean @default(false)  // déduite de la dernière VT (RG-M10-30)
  dataQualityFlags      String[]           // "inspection_date_suspect", "duplicate_plate"
}
```

Variables de modèles ajoutées (à reporter dans `02` §4) : `{{client.salutation}}` (« M. Kouassi », « Mme Bamba » ; sans civilité : `nomComplet` ; entreprise : nom du contact destinataire sinon « Madame, Monsieur »), `{{vehicules.liste}}`, `{{vehicules.nombre}}`, `{{factures.resume}}` (« la facture FAC-2026-000412 (185 000 FCFA) » ou « vos 4 factures (412 000 FCFA au total) »), `{{factures.detail}}` (une ligne par facture), `{{client.soldeEnRetard}}`, `{{client.joursRetardMax}}`, `{{promesse.date}}`, `{{promesse.montant}}`, `{{assurance.dateExpiration}}`, `{{or.numero}}`, `{{lien.avis}}`, `{{lien.releve}}`, `{{palier.libelle}}`.
