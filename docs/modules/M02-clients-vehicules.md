# M02 — Clients et véhicules

> Priorité : **P0** · Dépend de : M01 · Utilisé par : M03, M04, M05, M08, M09, M10, M11, M13, M14, M16, M17 · Rôles concernés : `ADVISOR`, `MANAGER`, `OWNER`, `CASHIER`, `ACCOUNTANT` (lecture pour `MECHANIC`, `STOREKEEPER`)

## 1. Objectif

Constituer un fichier clients et véhicules **propre, unique et à jour**, parce que toutes les relances (VT, révision, créances) en dépendent : un numéro mal saisi, un doublon ou une date de VT manquante, c'est une relance perdue et un client qui part ailleurs. Le module gère les particuliers et les entreprises (flottes), normalise téléphones et plaques, détecte et fusionne les doublons, suit le kilométrage et calcule les échéances VT et révision **au niveau du véhicule**, et offre une vue 360° (chronologie) ainsi qu'une recherche globale tolérante aux fautes.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Crée/retrouve un client au comptoir ou au téléphone, ajoute un véhicule, saisit la date de VT, consulte l'historique | Plusieurs dizaines de fois par jour |
| `MANAGER` | Fusionne les doublons, transfère un véhicule à un nouveau propriétaire, corrige un kilométrage | Hebdomadaire |
| `OWNER` | Consulte la fiche d'un gros client (flotte), son solde, son historique ; règle le crédit | Hebdomadaire |
| `CASHIER` | Retrouve un client pour encaisser, met à jour son téléphone | Quotidienne |
| `ACCOUNTANT` | Renseigne NCC/RCCM, conditions de paiement, plafond de crédit ; exporte | Mensuelle |
| `MECHANIC` | Consulte le véhicule (motorisation, historique technique) depuis sa tâche | Quotidienne |

## 3. User stories

**US-M02-01 — En tant que réceptionnaire, je veux créer un client particulier en moins de 30 secondes au comptoir.**
- Étant donné le formulaire rapide, quand je saisis « Kouassi », « Jean-Marc », « 07 47 21 88 90 », alors le téléphone est enregistré `+2250747218890`, `displayName = "Kouassi Jean-Marc"`, `source = "comptoir"`, et je peux enchaîner sur « Ajouter un véhicule » sans quitter l'écran.
- Étant donné un téléphone déjà présent sur un client actif, alors avant l'enregistrement un encart « Ce numéro appartient déjà à Kouassi Jean-Marc (Toyota Corolla 2547 GH 01) » propose « Ouvrir ce client » ou « Créer quand même » (motif requis : « numéro partagé », « autre »).
- Étant donné un champ téléphone vide, alors la création est autorisée mais un badge « Injoignable » apparaît et aucune relance ne pourra partir (sauf email).

**US-M02-02 — En tant que réceptionnaire, je veux créer une entreprise avec plusieurs interlocuteurs afin que la facture parte à la comptabilité et les rappels au responsable flotte.**
- Étant donné « SOTRA Logistique SARL », NCC « 1234567 A », deux contacts : « M. Diabaté — Responsable flotte » (`receivesReminders`) et « Mme N'Guessan — Comptabilité » (`receivesInvoices`), alors les relances VT/révision des véhicules partent à M. Diabaté, et les factures/relances de créance à Mme N'Guessan (M10/M11 lisent ces drapeaux).
- Étant donné une entreprise sans contact coché, alors les messages partent au téléphone principal de l'entreprise.

**US-M02-03 — En tant que réceptionnaire, je veux ajouter un véhicule par sa plaque, avec suggestions de marque et modèle.**
- Étant donné la saisie « 2547gh01 », alors la plaque est affichée et stockée `2547 GH 01` (RG-M02-05).
- Étant donné la saisie de « Toy », alors la liste propose « Toyota » puis les modèles « Corolla, Hilux, Land Cruiser, RAV4, Yaris… » du catalogue ; une saisie libre reste possible.
- Étant donné une plaque déjà existante dans l'organisation, alors le message « Ce véhicule existe déjà, propriétaire : Koné Ibrahim » propose « Ouvrir » ou « Transférer à ce client » (si `vehicle:transfer`).
- Étant donné le choix du modèle « Toyota Corolla », alors l'intervalle de révision est pré-rempli à 10 000 km / 12 mois (valeur du catalogue), modifiable.

**US-M02-04 — En tant que réceptionnaire, je veux scanner la carte grise afin d'éviter les fautes de saisie.**
- Étant donné une photo de la carte grise, quand je la soumets, alors M17 renvoie une proposition (plaque, VIN, marque, modèle, date de 1re mise en circulation, énergie) affichée en champs pré-remplis surlignés « suggéré par l'IA » ; rien n'est enregistré avant ma validation. La photo est conservée en `Attachment` (`entity = "vehicle"`, `kind = "document"`).

**US-M02-05 — En tant que gérant d'une flotte cliente, je veux que le garage voie les 12 véhicules d'un coup d'œil.**
- Étant donné la fiche SOTRA Logistique, onglet « Flotte », alors un tableau liste chaque véhicule : n° de parc, plaque, modèle, chauffeur, km estimé, VT (expiration + pastille), révision (échéance + pastille), dernier passage, montant facturé sur 12 mois.
- Étant donné le bouton « Ajouter plusieurs véhicules », alors un tableau éditable (ou collage depuis Excel) permet d'en saisir jusqu'à 50 d'un coup, avec validation ligne par ligne.

**US-M02-06 — En tant que réceptionnaire, je veux enregistrer la VT faite par le client afin que les relances VT se recalent.**
- Étant donné le Corolla 2547 GH 01, quand je clique « VT effectuée » et saisis le 20/10/2026, alors `inspectionLastDate = 2026-10-20`, `inspectionExpiryDate = 2027-10-20` (12 mois, RG-M02-12, modifiable car c'est la date du macaron qui fait foi), un `VehicleEvent` `inspection_done` est créé et `vehicle.inspection_updated` est émis (M10 annule les relances VT restantes et planifie le cycle suivant).

**US-M02-07 — En tant que réceptionnaire, je veux saisir un kilométrage et voir l'estimation de la prochaine révision.**
- Étant donné un relevé de 48 200 km le 18/10/2026, un relevé précédent de 42 500 km le 20/06/2026 (seuls relevés connus, 120 jours d'écart) et un intervalle 10 000 km / 12 mois après une révision à 40 000 km le 15/04/2026, alors : `avgKmPerDay = 5 700 / 120 = 47,5`, `nextServiceDueMileage = 50 000`, date estimée d'atteinte des 50 000 km = 18/10/2026 + ⌈1 800 / 47,5⌉ = 38 j = 25/11/2026, date calendaire = 15/04/2027 → `nextServiceDueDate = 2026-11-25` (le premier atteint) et la fiche affiche « Révision due vers le 25/11/2026 (≈ 50 000 km) ».
- Étant donné un relevé inférieur au dernier (ex. 4 820 au lieu de 48 200), alors le message « Kilométrage inférieur au dernier relevé (48 200 km le 18/10/2026). Vérifiez la saisie. » bloque, sauf choix explicite « Compteur remplacé / remis à zéro » (permission `vehicle:mileage_correct`).

**US-M02-08 — En tant que gérant, je veux détecter et fusionner les doublons afin de ne pas relancer deux fois la même personne.**
- Étant donné `/clients/doublons`, alors je vois des paires suggérées avec leur score et la raison (« même téléphone », « nom similaire à 92 % + même commune », « même véhicule »).
- Étant donné la fusion de « Kone Ibrahim » (2 factures) dans « Koné Ibrahim » (5 factures), alors l'écran de fusion montre champ par champ les deux valeurs et me laisse choisir ; après confirmation, tous les véhicules, OR, devis, factures, paiements, relances, conversations et messages pointent vers le client conservé, l'autre est supprimé logiquement avec `mergedIntoId`, et une entrée d'audit `customer.merge` contient l'instantané complet du client absorbé.
- Étant donné « Ignorer cette paire », alors elle ne sera plus proposée.

**US-M02-09 — En tant que réceptionnaire, je veux retrouver n'importe quoi depuis la barre de recherche, même avec une faute.**
- Étant donné « kouasi », alors « Kouassi Jean-Marc » apparaît en premier ; « 2547gh » trouve le véhicule 2547 GH 01 ; « 88 90 » trouve le client dont le numéro finit par 21 88 90 ; « FAC-2026-000412 » ou « 412 » trouve la facture ; « JTDBR32E » trouve un VIN.
- Étant donné une recherche, alors les résultats sont groupés (Clients, Véhicules, Documents) avec 5 résultats max par groupe, en < 300 ms pour 50 000 clients.
- Raccourci clavier `/` ou `Ctrl+K` sur PC ; icône loupe plein écran sur mobile.

**US-M02-10 — En tant que gérant, je veux voir l'historique complet d'un client ou d'un véhicule sur une seule chronologie.**
- Étant donné la fiche client, onglet « Chronologie », alors s'affichent par ordre antéchronologique : RDV, OR (avec statut), devis (envoyé/accepté), factures, paiements, relances (canal + statut : envoyé, délivré, lu, échec), messages entrants, promesses de paiement, notes internes, relevés de km, VT effectuées, changements de propriétaire. Filtres par type et par véhicule.
- Étant donné la fiche véhicule, la chronologie montre l'historique **technique** du véhicule, y compris les passages sous un ancien propriétaire (sans montants ni nom de l'ancien propriétaire, RG-M02-17).

**US-M02-11 — En tant que gérant, je veux transférer un véhicule vendu à un nouveau propriétaire.**
- Étant donné le Peugeot 301 4421 FD 01 de Koné Ibrahim vendu à Yao Adjoua, quand je lance « Changer de propriétaire » avec date de vente 10/10/2026, alors `customerId` change, un `VehicleEvent` `owner_changed` `{ fromCustomerId, toCustomerId, date }` est créé, les relances planifiées pour ce véhicule au nom de Koné sont annulées (`CANCELLED`, motif « changement de propriétaire ») et replanifiées pour Yao, les factures impayées restent dues par Koné.
- Étant donné un OR ouvert sur ce véhicule, alors le transfert est refusé : « Un OR est en cours (OR-YOP-2026-00042). Terminez-le avant de changer de propriétaire. »

**US-M02-12 — En tant que réceptionnaire, je veux enregistrer qu'un client répond STOP ou ne veut plus être relancé.**
- Étant donné un message entrant « STOP » (M11), alors `optedOutAt` est renseigné, une ligne `OptOut` est créée pour l'adresse et le canal, la fiche affiche « Désinscrit des relances le 12/10/2026 (STOP par WhatsApp) ».
- Étant donné « Ne plus relancer » cliqué par le personnel avec motif « Client en litige », alors `doNotRemind = true`, `doNotRemindReason` rempli, et toutes les relances `PLANNED`/`NEEDS_APPROVAL` du client passent `CANCELLED` ; les messages transactionnels (facture, véhicule prêt, confirmation RDV) restent autorisés.
- Étant donné un client qui redemande les rappels, alors « Réactiver » (permission `customer:consent`) efface `optedOutAt`, supprime l'`OptOut` et enregistre la preuve (canal, date, utilisateur).

**US-M02-13 — En tant que comptable, je veux exporter ou anonymiser les données d'un client sur demande (loi 2013-450).**
- Étant donné « Exporter ses données », alors un fichier ZIP (JSON + PDF des factures) est généré en tâche de fond et téléchargeable 24 h.
- Étant donné « Supprimer ses données », alors si le client a des factures émises, il est **anonymisé** (nom → « Client anonymisé #A7F3 », téléphones/email/adresse effacés, véhicules détachés de toute donnée personnelle, conversations supprimées) mais les factures conservent leurs mentions légales (obligation de conservation 10 ans) ; sinon il est supprimé logiquement puis purgé à J+30.

**US-M02-14 — En tant que gérant, je veux étiqueter et segmenter mes clients afin de cibler une campagne.**
- Étant donné des tags « VIP », « Taxi », « Flotte », alors je peux filtrer la liste et enregistrer un segment « Particuliers Toyota sans visite depuis 12 mois » réutilisable par M10 (campagne `CUSTOM`) et M12.

## 4. Règles métier

**RG-M02-01 — Nom affiché.** `INDIVIDUAL` : `displayName = trim(lastName + " " + firstName)` (usage ivoirien : nom puis prénoms), majuscule initiale à chaque mot, particules conservées (« N'Guessan », « Kouadio-Konan »). `COMPANY` : `displayName = companyName`. Un particulier exige `lastName` ; une entreprise exige `companyName`.

**RG-M02-02 — Particulier dans une entreprise.** Un chauffeur ou un salarié qui vient avec un véhicule de flotte n'est **pas** un client : il est saisi en `Vehicle.driverName/driverPhone`. La facture va à l'entreprise.

**RG-M02-03 — Normalisation téléphone** (`core/phone.normalize(input, defaultCountry = "CI")`) :
1. Retirer espaces, points, tirets, parenthèses ; `00` initial → `+`.
2. `+225` + 10 chiffres → valide si le préfixe national est `01`, `05`, `07` (mobiles Moov, MTN, Orange) ou `21`, `25`, `27` (fixes).
3. 10 chiffres commençant par l'un de ces préfixes → préfixer `+225`.
4. 8 chiffres (ancien plan, avant 2021) → conversion selon la table `LEGACY_PREFIX_MAP` (ex. ancien mobile Orange `08 12 34 56` → `07 08 12 34 56`) ; le résultat est marqué `converted: true` et l'interface affiche « Ancien numéro à 8 chiffres converti en 07 08 12 34 56 — vérifiez avec le client ».
5. Autre indicatif international (`+33…`, `+226…`) → accepté tel quel si conforme E.164 (diaspora, clients burkinabè).
6. Sinon → `INVALID_PHONE`.
Retour : `{ e164, national: "07 08 12 34 56", type: "MOBILE" | "FIXED" | "FOREIGN", operator?: "ORANGE" | "MTN" | "MOOV", converted }`. Un numéro `FIXED` ne reçoit jamais de WhatsApp ni de SMS (repli email ou appel).

**RG-M02-04 — WhatsApp.** `hasWhatsapp` vaut `null` à la création ; M11 le passe à `true` au premier message délivré, à `false` après un échec Meta « numéro non WhatsApp ». Le personnel peut le forcer. Si `whatsappPhone` est renseigné, il est utilisé pour WhatsApp à la place de `phone`.

**RG-M02-05 — Normalisation plaque** (`core/plate.normalize`) :
1. Majuscules, suppression des caractères hors `[A-Z0-9]`. Aucune correction automatique des confusions `0/O`, `1/I` (on garde ce qui est saisi) ; en revanche la recherche (RG-M02-19) tolère ces confusions.
2. Forme compacte `plateCompact` (ex. `2547GH01`) utilisée pour l'unicité et la recherche.
3. Si `plateCompact` correspond à `^(\d{1,4})([A-Z]{2})(\d{2})$` → affichage `2547 GH 01`, `plateType = STANDARD`.
4. Plaques provisoires « WW » / garage « W » (ex. `WW 4512 01`) → `plateType = TEMPORARY` ; à la réception de la plaque définitive, « Remplacer la plaque » conserve l'ancienne dans un `VehicleEvent` `plate_changed`.
5. Plaques diplomatiques (`CD`, `CMD`), administratives, étrangères (ex. `11 AB 1234` Burkina) → `plateType` correspondant, format libre conservé en majuscules avec espaces simples.
6. Véhicule sans plaque (neuf, importé en cours de dédouanement) → `plateType = NONE`, `plate = "SANS PLAQUE"`, VIN obligatoire ; l'unicité ne s'applique pas.
Unicité : (`organizationId`, `plateCompact`) parmi les véhicules non supprimés et `plateType ≠ NONE`.

**RG-M02-06 — VIN.** 17 caractères alphanumériques sans `I`, `O`, `Q` ; stocké en majuscules. Avertissement (non bloquant) si la longueur ≠ 17 (véhicules anciens). Unicité souple : un VIN existant déclenche l'alerte doublon.

**RG-M02-07 — Détection de doublons clients** (`core/customers/duplicates.ts`, score 0-100) :
| Signal | Points |
|---|---|
| Même `phone`/`phone2`/`whatsappPhone` (E.164) | +60 |
| Même email | +50 |
| Même NCC (entreprises) | +70 |
| Similarité `displayName` (pg_trgm) ≥ 0,85 | +35 ; entre 0,6 et 0,85 : +20 |
| Même commune | +5 |
| Partagent un véhicule (même `plateCompact` ou VIN) | +40 |
Score ≥ 80 : alerte bloquante à la création (« Créer quand même » avec motif). 50-79 : suggestion dans `/clients/doublons`. Calcul à la création/modification (synchrone, 5 meilleurs candidats via index trigram) et en lot nocturne (`customers.detect_duplicates`, 03:30). Les paires ignorées sont mémorisées (`DuplicateDismissal`).

**RG-M02-08 — Fusion.** `customer.merge(sourceId → targetId)` en **une transaction** :
- Réaffecte `customerId` sur : `Vehicle`, `CustomerContact`, `Appointment`, `RepairOrder`, `Quote`, `Invoice`, `Payment`, `CollectionCase` (si les deux ont un dossier ouvert : fusion des montants, promesses et notes dans celui de la cible, l'autre fermé `closeReason = "fusion"`), `Reminder`, `Conversation` (si conflit d'unicité canal/adresse : messages déplacés puis conversation source supprimée), `Message`, `InsuranceClaim`, `CustomerNote`, `ExternalRef` (`internalId`).
- Champs : pour chaque champ, la valeur choisie à l'écran ; par défaut la valeur non vide la plus récente. `tags` = union. Consentements : on retient le **plus restrictif** (si l'un est désinscrit, le résultat l'est).
- Relances : recalcul des `dedupeKey` ; en cas de collision, la relance de la source est `CANCELLED` (« doublon fusionné »).
- Source : `deletedAt = now`, `mergedIntoId = targetId`. Les factures émises **ne sont pas modifiées** dans leurs mentions imprimées (elles gardent le nom au moment de l'émission, figé dans le PDF) ; seul leur `customerId` change.
- Audit `customer.merge` avec instantané JSON de la source. Pas d'annulation automatique (opération irréversible, confirmation par saisie du nom du client absorbé).
La fusion de **véhicules** (doublon de plaque issu d'un import) suit la même logique sur `MileageReading`, `VehicleEvent`, `Appointment`, `RepairOrder`, `Quote`, `Invoice`, `Reminder`, `Attachment`.

**RG-M02-09 — Relevés kilométriques.** Chaque saisie crée un `MileageReading` et met à jour `currentMileage/currentMileageAt` si le relevé est le plus récent. Contrôles :
- Relevé < dernier relevé connu → refus sauf `odometerReset` (permission `vehicle:mileage_correct`) : un `VehicleEvent` `odometer_replaced { oldMileage, newStartMileage }` est créé et `odometerOffset += ancienDernierRelevé − nouveauRelevé` ; tous les calculs utilisent `mileage + odometerOffset` (kilométrage « vie entière »).
- Vitesse implicite > 1 000 km/jour depuis le dernier relevé → avertissement « 5 200 km en 2 jours : saisie correcte ? » (confirmation requise).
- Relevés avec `source = IMPORT` dont la date est antérieure au dernier relevé `RECEPTION` sont stockés mais ne remplacent pas `currentMileage`.

**RG-M02-10 — Kilométrage moyen par jour** (`core/vehicles/mileage.ts#computeAvgKmPerDay`) :
- Relevés des 18 derniers mois, triés par date ; on écarte ceux marqués aberrants.
- Il faut ≥ 2 relevés espacés d'au moins 14 jours ; sinon `avgKmPerDay = null`.
- Calcul : régression linéaire des moindres carrés (km en fonction du jour), pondérée ×2 pour les relevés des 6 derniers mois ; résultat borné à [0 ; 800].
- À défaut (`null`), valeur par défaut selon `usage` : `PRIVATE` 35, `TAXI` 220, `TRANSPORT` 250, `UTILITY` 90, `RENTAL` 120 km/j (paramétrable dans M15) ; l'interface indique alors « estimation par défaut ».
- Si un seul relevé existe et `firstRegistrationDate` est connue : `currentMileage / joursDepuisMiseEnCirculation`, borné, si l'âge ≥ 180 jours.
- **IA (M17)** : peut proposer une valeur affinée (saisonnalité, profils similaires) ; M02 l'affiche comme suggestion, la valeur calculée reste la référence tant que l'humain ne l'a pas acceptée.

**RG-M02-11 — Kilométrage estimé du jour.** `estimatedMileage = currentMileage + round(avgKmPerDay × joursDepuis(currentMileageAt))`. Recalculé par `vehicles.estimate_mileage` (02:00) et à chaque nouveau relevé.

**RG-M02-12 — Visite technique.**
- Durée de validité par défaut selon `usage` (paramétrable M15) : `PRIVATE` 12 mois, `TAXI`/`TRANSPORT` 6 mois, `UTILITY`/`RENTAL` 12 mois.
- « VT effectuée le D » → `inspectionLastDate = D`, `inspectionExpiryDate = D + durée` (proposée, modifiable : la date du macaron fait foi), `inspectionCenter` facultatif (liste : SICTA Yopougon, SICTA Abobo, SICTA Koumassi, SICTA Marcory, SICTA Plateau/Cocody, autre).
- Statut affiché : `À jour` (> 30 j), `Bientôt` (≤ 30 j), `Expirée` (< aujourd'hui, avec « depuis N j »), `Inconnue` (pas de date) ; compte à rebours « J-15 ».
- Un véhicule sans date de VT n'est **pas** relancé pour la VT ; il apparaît dans la liste « VT inconnues » pour que la réception la demande au prochain contact (M10 peut envoyer une demande d'information, règle optionnelle).

**RG-M02-13 — Prochaine révision (premier atteint entre date et km)** — `core/reminders/serviceDue.ts#computeNextServiceDue`, appelée par M02 (relevé, saisie de révision) et M10 :
```
Entrées : lastServiceDate?, lastServiceMileage?, serviceIntervalKm?, serviceIntervalMonths?,
          currentMileage?, currentMileageAt?, avgKmPerDay?, today
dueByDate    = lastServiceDate + serviceIntervalMonths      (si les deux connus)
dueMileage   = lastServiceMileage + serviceIntervalKm       (si les deux connus)
dateForKm    = si dueMileage et avgKmPerDay > 0 :
                 currentMileageAt + ceil((dueMileage − currentMileage) / avgKmPerDay) jours
                 (si dueMileage ≤ kilométrage estimé du jour → today : « dépassée »)
nextServiceDueDate    = min(dueByDate, dateForKm)  (celle qui existe si une seule)
nextServiceDueMileage = dueMileage ?? round(estimatedMileageAt(nextServiceDueDate))
trigger               = "DATE" | "MILEAGE"  (celui qui a donné le min)
```
- Valeurs par défaut des intervalles : catalogue du modèle, sinon paramètre organisation (10 000 km / 12 mois ; 5 000 km / 6 mois si `usage = TAXI`).
- Si `lastServiceDate` est inconnu mais `lastServiceMileage` connu → seul le critère km joue ; si rien n'est connu → `nextServiceDue*` = null, véhicule listé « Révision : historique inconnu ».
- Une facture (M08) ou un OR clôturé (M04) contenant une opération marquée « révision » (`LaborOperation.isServiceOperation = true`, champ ajouté par M05 §14) met à jour `lastServiceDate/lastServiceMileage` automatiquement.
- Exemple : révision le 15/04/2026 à 40 000 km, intervalle 10 000 km / 12 mois, dernier relevé 48 200 km le 18/10/2026, 47,5 km/j → due le **25/11/2026** (par le km), pas le 15/04/2027.

**RG-M02-14 — Assurance.** `insuranceExpiryDate` alimente la relance `INSURANCE_EXPIRY` (M10) si la règle est active ; statut affiché comme pour la VT.

**RG-M02-15 — Consentements.**
- À la création : `remindersConsent = true` (intérêt légitime pour les rappels d'entretien d'un client existant, base légale à valider avec l'ARTCI), `marketingConsent = false` (case à cocher explicite, jamais pré-cochée).
- Toute modification de consentement trace `consentUpdatedAt`, `consentSource` (`counter | phone | whatsapp_reply | portal | import | staff`) et une entrée d'audit `customer.consent_changed`.
- Hiérarchie lue par M10/M11 avant **chaque** envoi : `doNotRemind` ou `optedOutAt` ou `OptOut(adresse, canal)` ⇒ pas de relance ni de marketing ; messages transactionnels autorisés. `remindersConsent = false` ⇒ pas de relance ; `marketingConsent = false` ⇒ pas de campagne.

**RG-M02-16 — Crédit client.** `paymentTermsDays` (0 = comptant, 30, 45, 60…) et `creditLimit` modifiables uniquement avec `customer:credit`. La fiche affiche « Encours : 1 240 000 / 2 000 000 FCFA ». Le blocage au-delà du plafond est appliqué par M08 (facturation) et M04 (restitution).

**RG-M02-17 — Confidentialité de l'historique véhicule.** Sur la fiche véhicule, les documents liés à un ancien propriétaire affichent date, km, travaux réalisés, mais **ni montants, ni nom** de l'ancien propriétaire (« Ancien propriétaire »). Les factures restent sur la fiche de l'ancien client.

**RG-M02-18 — Suppression.** Client ou véhicule : suppression logique (`deletedAt`), refusée si un OR non clôturé, un devis `SENT/VIEWED` ou une facture avec solde existe (« Ce client a 185 000 FCFA d'impayés. »). Un client supprimé disparaît des listes et de la recherche, ses relances sont annulées.

**RG-M02-19 — Recherche globale** (`search.global`) : requête normalisée (minuscules, sans accents via `unaccent`) ; si elle ressemble à un téléphone (≥ 4 chiffres) → recherche par suffixe sur `phone`, `phone2`, `whatsappPhone`, `Vehicle.driverPhone`, `CustomerContact.phone` ; si elle ressemble à une plaque → `plateCompact ILIKE '%…%'` puis similarité trigram ; si préfixe de document (`OR-`, `DEV-`, `FAC-`, `AV-`, `REC-`, `BC-`) ou nombre → `number` ; sinon similarité trigram (`%` opérateur, seuil 0,3) sur `displayName`, `companyName`, `CustomerContact.name`, `vin`, `fleetNumber`. Classement : correspondance exacte > préfixe > similarité, puis date de dernière activité. Résultats limités aux sites autorisés pour les documents (RG-M01-09).

**RG-M02-20 — Catalogue marques/modèles.** Catalogue global (géré par la plateforme) + ajouts propres à l'organisation. Semences : Toyota, Hyundai, Kia, Nissan, Mitsubishi, Suzuki, Isuzu, Peugeot, Renault, Citroën, Mercedes-Benz, BMW, Ford, Honda, Mazda, Volkswagen, Land Rover, Chevrolet, Changan, Geely, Chery, Dongfeng, Great Wall, JAC, Tata, avec leurs modèles courants en Côte d'Ivoire et un intervalle de révision par défaut. Une marque saisie librement 3 fois dans l'organisation est proposée à l'ajout au catalogue local.

## 5. Machine à états

Pas de machine à états métier. États dérivés affichés :
- **VT** : `UNKNOWN → OK → DUE_SOON → EXPIRED → (VT effectuée) → OK`.
- **Révision** : `UNKNOWN → OK → DUE_SOON (≤ 30 j ou ≤ 1 000 km) → OVERDUE → (révision réalisée) → OK`.
- **Joignabilité client** : `REACHABLE` (téléphone mobile ou email valide, pas de désinscription) · `OPTED_OUT` · `DO_NOT_REMIND` · `UNREACHABLE` (aucun moyen de contact).

## 6. Données

Entités de `02` : `Customer`, `CustomerContact`, `Vehicle`, `MileageReading`, `VehicleEvent`, `OptOut`, `Attachment`, `AuditLog`, `ExternalRef` (fusion), lecture de `Invoice` (solde), `RepairOrder`, `Appointment`, `Quote`, `Payment`, `Reminder`, `Message` (chronologie).

Types de `VehicleEvent.type` normalisés (constante `VEHICLE_EVENT_TYPES`) : `inspection_done`, `service_done`, `owner_changed`, `plate_changed`, `odometer_replaced`, `accident`, `insurance_renewed`, `note`, `merged`.

Champs ajoutés : voir §14 (`plateCompact`, `plateType`, `usage`, `odometerOffset`, `mergedIntoId`, consentements tracés, `CustomerNote`, `DuplicateDismissal`, `CustomerSegment`, catalogue `VehicleMake`/`VehicleModel`).

## 7. Écrans et interface

| Route | Contenu | Actions / filtres | Mobile |
|---|---|---|---|
| `/(app)/clients` | Tableau : nom (+ badge Particulier/Entreprise), téléphone (+ pastille WhatsApp oui/non/inconnu), nb véhicules, solde dû, dernière visite, tags, statut de joignabilité | Recherche, filtres (type, a des impayés, VT ≤ 30 j, révision due, tag, commune, désinscrit, segment), tri, export CSV (`customer:export`), « Nouveau client » | Cartes : nom, téléphone, solde ; boutons Appeler/WhatsApp |
| `/(app)/clients/nouveau` | Formulaire en 2 blocs : identité (bascule Particulier/Entreprise) et contact ; bloc facultatif « Véhicule » ; alertes de doublon en direct | Enregistrer, Enregistrer et créer un OR, Enregistrer et prendre RDV | Une colonne, `PhoneInput` avec clavier numérique |
| `/(app)/clients/[id]` | **En-tête** : nom, type, tags, téléphones (Appeler, WhatsApp, SMS), email, canal préféré, badges consentement/désinscription. **Bloc solde** : dû, en retard, plafond. **Onglets** : Aperçu (véhicules en cartes avec statuts VT/révision, prochains RDV, devis en attente), Flotte (entreprises), Chronologie, Documents (OR, devis, factures), Contacts, Infos (fiscal, crédit, notes, source) | Modifier, Ajouter véhicule, Nouvelle note, Nouveau RDV, Nouvel OR, Ne plus relancer, Fusionner avec…, Exporter/Anonymiser | En-tête compact + onglets défilants |
| `/(app)/clients/doublons` | Paires suggérées : deux colonnes côte à côte, score, raisons | Fusionner, Ignorer ; écran de fusion champ par champ avec aperçu du résultat et décompte des documents déplacés | Une paire par écran |
| `/(app)/clients/segments` | Segments enregistrés : nom, filtres, nb de clients | Créer, modifier, dupliquer, utiliser dans une campagne (lien M10) | |
| `/(app)/vehicules` | Tableau : plaque (`PlateBadge`), marque/modèle/année, propriétaire, km estimé, VT (date + pastille), révision (date/km + pastille), dernier passage | Filtres : VT expirée/≤ 7 j/≤ 30 j/inconnue, révision due, marque, usage, type de plaque ; vues enregistrées | Cartes |
| `/(app)/vehicules/[id]` | **En-tête** : plaque, marque/modèle/version/année, VIN, énergie, boîte, couleur, propriétaire (lien), chauffeur. **Cartes** : VT (compte à rebours, centre, bouton « VT effectuée »), Révision (barre de progression km depuis dernière révision, date estimée, critère déclencheur « par le km »/« par la date », bouton « Révision effectuée »), Kilométrage (dernier relevé, estimé, km/j, mini-graphe des relevés), Assurance. **Onglets** : Chronologie technique, Documents, Photos/pièces jointes | Saisir un km, Changer de propriétaire, Remplacer la plaque, Modifier intervalles, Scanner la carte grise | Cartes empilées ; « VT effectuée » et « Saisir km » en boutons larges |
| Modale « Recherche globale » | Champ unique, résultats groupés, navigation clavier, dernières recherches | Entrée = ouvrir | Plein écran |

**Composants partagés** (`packages/ui`) : `PhoneInput` (normalisation en direct + affichage national + opérateur), `PlateInput` / `PlateBadge` (format plaque CI, type), `DueBadge` (« J-15 », « Expirée depuis 6 j »), `MileageProgress`, `CustomerPicker` (recherche + création rapide en ligne), `VehiclePicker` (filtré par client, création rapide), `Timeline`.

**États vides** : liste clients vide → « Aucun client pour l'instant. Importez votre fichier ou créez votre premier client. » (boutons Import / Nouveau client) ; chronologie vide → « Pas encore d'historique. »

## 8. API

| Procédure | Entrée | Sortie |
|---|---|---|
| `customer.list` | `{ q?, type?, tags?, hasBalance?, inspectionWithinDays?, serviceDue?, optedOut?, segmentId?, commune?, sort, cursor, limit≤100 }` | `{ items: CustomerListItem[], nextCursor }` |
| `customer.get` | `{ id }` | client + contacts + véhicules (résumé) + `balance { due, overdue, creditLimit }` + `reachability` |
| `customer.create` | `CustomerInput` (Zod discriminé par `type`) + `vehicle?: VehicleInput` + `duplicateOverrideReason?` | `{ customer, vehicle?, duplicates?: Candidate[] }` — erreur `DUPLICATE_SUSPECTED` (score ≥ 80) avec candidats si pas de motif |
| `customer.update` | `{ id, patch }` | client |
| `customer.checkDuplicates` | `{ phone?, email?, name?, ncc?, excludeId? }` | `Candidate[] { customerId, displayName, score, reasons[] }` |
| `customer.duplicates.list` / `.dismiss` | `{ cursor }` / `{ customerIdA, customerIdB }` | paires |
| `customer.merge.preview` | `{ sourceId, targetId }` | champs en conflit + compte des documents à déplacer |
| `customer.merge` | `{ sourceId, targetId, fieldChoices: Record<field,'source'\|'target'>, confirmName }` | `{ targetId, moved: Record<entity, number> }` |
| `customer.setConsent` | `{ id, remindersConsent?, marketingConsent?, doNotRemind?, reason?, source }` | client |
| `customer.reactivateReminders` | `{ id, source, proof? }` | client |
| `customer.setCredit` | `{ id, paymentTermsDays, creditLimit? }` | client |
| `customer.timeline` | `{ id, vehicleId?, types?: TimelineType[], cursor }` | `{ items: TimelineItem[], nextCursor }` |
| `customer.addNote` | `{ customerId, vehicleId?, body, pinned? }` | note |
| `customer.delete` | `{ id, reason }` | `{ ok }` |
| `customer.exportData` / `customer.anonymize` | `{ id }` / `{ id, reason, confirm: true }` | `{ jobId }` / `{ ok }` |
| `contact.create/update/delete` | champs `CustomerContact` | contact |
| `vehicle.list` | `{ q?, customerId?, inspectionStatus?, serviceStatus?, make?, usage?, plateType?, cursor }` | page |
| `vehicle.get` | `{ id }` | véhicule + statuts VT/révision calculés + derniers relevés |
| `vehicle.create` | `VehicleInput` | véhicule — erreur `PLATE_EXISTS { vehicleId, ownerName }` |
| `vehicle.bulkCreate` | `{ customerId, vehicles: VehicleInput[] ≤ 50 }` | `{ created, errors: {row, message}[] }` |
| `vehicle.update` | `{ id, patch }` | véhicule (recalcul révision si intervalles modifiés) |
| `vehicle.recordMileage` | `{ vehicleId, mileage, readAt, source, odometerReset?, confirmHighRate? }` | `{ vehicle, warnings[] }` |
| `vehicle.recordInspection` | `{ vehicleId, date, expiryDate?, center? }` | véhicule |
| `vehicle.recordService` | `{ vehicleId, date, mileage, repairOrderId? }` | véhicule |
| `vehicle.transferOwner` | `{ vehicleId, toCustomerId, effectiveDate, note? }` | véhicule |
| `vehicle.replacePlate` | `{ vehicleId, newPlate, plateType }` | véhicule |
| `vehicle.merge` | `{ sourceId, targetId }` | `{ moved }` |
| `vehicle.delete` | `{ id, reason }` | `{ ok }` |
| `vehicle.scanRegistration` | `{ attachmentId }` | `{ suggestion: Partial<VehicleInput>, confidence, aiInteractionId }` (délégué à M17) |
| `catalog.makes` / `catalog.models` | `{ q? }` / `{ makeId, q? }` | listes |
| `catalog.addLocalModel` | `{ make, model, serviceIntervalKm?, serviceIntervalMonths? }` | modèle |
| `segment.list/create/update/delete/preview` | `{ name, filters }` | segment / `{ count, sample[] }` |
| `search.global` | `{ q, limit≤5 par groupe }` | `{ customers[], vehicles[], documents[] }` |

API REST publique (M13, clé API, scopes `customers:read/write`, `vehicles:read/write`) : `GET/POST /api/v1/customers`, `GET/PATCH /api/v1/customers/{id}`, `GET/POST /api/v1/vehicles`, `PATCH /api/v1/vehicles/{id}`, `POST /api/v1/vehicles/{id}/mileage`, `POST /api/v1/vehicles/{id}/inspection`. Mêmes validations que tRPC ; `externalId` accepté pour l'idempotence via `ExternalRef`.

## 9. Automatisations et événements

**Émis** :
| Événement | Quand | Consommateurs |
|---|---|---|
| `customer.created` / `customer.updated` | création, modification | M10 (éligibilité), M13 (webhooks sortants) |
| `customer.merged` | fusion | M10 (recalcul des dédoublonnages), M11 (conversations), M12 |
| `customer.consent_changed` | consentement modifié | M10 (annulation/replanification) |
| `vehicle.mileage_recorded` | nouveau relevé | M10 (révision), M17 |
| `vehicle.inspection_updated` | VT saisie/modifiée | M10 (VT) |
| `vehicle.service_recorded` | révision saisie | M10 |
| `vehicle.owner_changed` | transfert | M10 (annule/replanifie), M11 |

**Consommés** : `message.inbound_received` contenant STOP (géré par M11, qui appelle `customer.setConsent`), `repair_order.status_changed` → `DELIVERED` (relevé km `RECEPTION` déjà créé par M04 ; M02 recalcule), `invoice.issued` (mise à jour révision si opération « Révision »).

**Worker** : `vehicles.estimate_mileage` (02:00, par organisation) — recalcule `avgKmPerDay`, `estimatedMileage`, `nextServiceDue*` pour les véhicules ayant un nouveau relevé ou dont l'estimation a plus de 7 jours ; `customers.detect_duplicates` (03:30) ; `customers.purge_deleted` (hebdomadaire, purge définitive des suppressions demandées à J+30 sans facture).

**IA (M17)** : lecture de carte grise (OCR), suggestion d'`avgKmPerDay` affinée, détection de doublons « sémantiques » (« Ets Bamba et Fils » ≈ « Bamba & Fils »), proposition de tags (ex. « Taxi » si ≥ 3 relevés > 200 km/j), résumé en une phrase de la chronologie d'un client en tête de fiche (« Client fidèle depuis 2023, 7 passages, paie à 15 jours en moyenne »).

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir clients / véhicules | `customer:read` / `vehicle:read` | Tous |
| Créer / modifier client | `customer:create` / `customer:update` | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |
| Supprimer client | `customer:delete` | OWNER, MANAGER |
| Fusionner (clients et véhicules) | `customer:merge` | OWNER, MANAGER |
| Exporter la liste / les données d'un client | `customer:export` | OWNER, ACCOUNTANT |
| Modifier consentements, ne plus relancer, réactiver | `customer:consent` | OWNER, MANAGER, ADVISOR |
| Conditions de paiement, plafond de crédit | `customer:credit` | OWNER, ACCOUNTANT |
| Créer / modifier véhicule, saisir km, VT, révision | `vehicle:create` / `vehicle:update` | OWNER, MANAGER, ADVISOR (le km de réception est aussi saisi via M04 avec `repair_order:create`) |
| Changer de propriétaire, remplacer la plaque | `vehicle:transfer` | OWNER, MANAGER |
| Corriger un km (compteur remplacé) | `vehicle:mileage_correct` | OWNER, MANAGER |
| Supprimer véhicule | `vehicle:delete` | OWNER, MANAGER |
| Anonymiser un client | `customer:delete` + `customer:export` | OWNER |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Un même téléphone pour toute une famille | Alerte doublon ; « Créer quand même » avec motif « numéro partagé » ; les deux clients reçoivent leurs relances respectives (dedupe par véhicule, pas par numéro). |
| Client sans WhatsApp (téléphone simple) | `hasWhatsapp = false` après le premier échec ou saisie manuelle ; M11 passe directement au SMS. |
| Client sans téléphone ni email | Création autorisée, badge « Injoignable », exclu des relances, listé dans le rapport « Fiches incomplètes ». |
| Numéro fixe (27 22 41 55 00) | Accepté ; ni WhatsApp ni SMS ; la fiche propose d'ajouter un mobile. |
| Plaque provisoire WW puis définitive | « Remplacer la plaque » ; recherche par l'ancienne plaque toujours possible (via `VehicleEvent`). |
| Véhicule de location/taxi qui change souvent de chauffeur | `driverName/driverPhone` modifiables ; les relances vont au propriétaire, jamais au chauffeur (sauf contact marqué `receivesReminders`). |
| Flotte de 12 véhicules dont la VT expire le même mois | M10 regroupe en un seul message par contact (règle M10) ; la fiche flotte offre « Planifier les VT » (création de RDV en lot, M03). |
| Import qui crée 300 doublons | Détection nocturne ; `/clients/doublons` propose « Fusionner automatiquement les paires ≥ 95 avec même téléphone ET même nom » (aperçu, confirmation, audit par fusion). |
| Fusion de deux clients ayant chacun un dossier de recouvrement | Dossiers fusionnés dans la cible (RG-M02-08) ; le palier retenu est le plus avancé. |
| Fusion alors qu'un utilisateur édite la fiche source | La sauvegarde de l'éditeur échoue : « Ce client a été fusionné dans Koné Ibrahim. » + lien. |
| Kilométrage saisi en miles (véhicule importé US) | Pas de conversion automatique ; champ « Compteur en miles » sur le véhicule (§14) : saisie en miles, stockage en km (×1,609, arrondi). |
| VT saisie avec une date d'expiration antérieure à la date de visite | Refus : « La date d'expiration doit être après la date de la visite. » |
| Véhicule transféré alors que des relances créance concernent l'ancien propriétaire | Les relances créance restent attachées à l'ancien client (elles portent sur la facture, pas sur le véhicule). |
| Recherche « 01 » (trop courte) | Pas de recherche sous 2 caractères ; message « Tapez au moins 2 caractères. » |
| Client désinscrit qui prend RDV | La confirmation de RDV (transactionnelle) part ; les rappels VT/révision non. |
| Client étranger (+226) | Accepté ; WhatsApp autorisé ; SMS selon couverture du fournisseur (M11 gère l'échec). |

## 12. Tests

**Unitaires (`core`)** :
- `phone.normalize` : `0708123456`, `07 08 12 34 56`, `+225 07-08-12-34-56`, `002250708123456`, ancien `08123456` (conversion + `converted`), fixe `2722415500`, `+22670123456`, invalides (`123`, `0908123456`).
- `plate.normalize` : `2547gh01`, `2547-GH-01`, ` 2547  gh 01 `, provisoire `WW 4512 01`, diplomatique, `SANS PLAQUE`.
- `computeAvgKmPerDay` : < 2 relevés, relevés < 14 j d'écart, pondération récente, bornes, défaut par usage, compteur remplacé (offset).
- `computeNextServiceDue` : date seule, km seul, les deux (km gagne : exemple RG-M02-13 → 25/11/2026 ; date gagne), dépassée, données manquantes, `avgKmPerDay = 0`.
- `inspectionStatus` et `serviceStatus` aux bornes (J-31, J-30, J0, J+1).
- `duplicateScore` : chaque signal, cumul, seuils 50/80.
- `mergePlan` : choix de champs, union des tags, consentement le plus restrictif, collisions de `dedupeKey`.

**Intégration** : fusion transactionnelle sur un jeu complet (véhicules, OR, factures, relances, conversation en conflit d'unicité, dossier de recouvrement) avec rollback si une étape échoue ; transfert de propriétaire (relances annulées/replanifiées, refus si OR ouvert) ; unicité de plaque parmi les non supprimés ; recherche trigram sur 50 000 clients (< 300 ms, index `gin_trgm_ops` présents) ; isolation multi-locataire sur `search.global` ; STOP → `OptOut` + relances annulées.

**E2E Playwright** : créer « Kouassi Jean-Marc » avec « 07 47 21 88 90 » et la Toyota Corolla « 2547gh01 » → saisir km 48 200 → vérifier « Révision due vers le … » → « VT effectuée » le 20/10/2026 → créer un doublon « Kouasi Jean Marc » même numéro (alerte, créer quand même avec motif) → fusionner depuis `/clients/doublons` → vérifier que la recherche « kouasi » ne renvoie plus qu'un client avec 1 véhicule.

## 13. Définition de « terminé »

- [ ] `core/phone`, `core/plate`, `core/vehicles/mileage`, `core/reminders/serviceDue`, `core/customers/duplicates`, `core/customers/merge` livrés avec tests couvrant tous les exemples du PRD.
- [ ] Extension `pg_trgm` + `unaccent`, index trigram sur `Customer.displayName`, `Vehicle.plateCompact`, `Vehicle.vin`, `CustomerContact.name` ; index sur téléphones.
- [ ] Écrans clients, fiche client (5 onglets), véhicules, fiche véhicule, doublons, segments, recherche globale — responsive, avec états vides/chargement/erreur.
- [ ] Fusion clients et véhicules transactionnelle et auditée ; transfert de propriétaire ; remplacement de plaque.
- [ ] Consentements tracés, STOP opérationnel avec M11, export/anonymisation.
- [ ] Catalogue marques/modèles semé ; lecture de carte grise branchée sur M17 (désactivable).
- [ ] Événements émis et consommés idempotents ; job `vehicles.estimate_mileage` opérationnel.
- [ ] Endpoints REST `/api/v1/customers` et `/api/v1/vehicles` documentés dans l'OpenAPI.
- [ ] E2E vert.

## 14. Évolutions du modèle de données

```prisma
model Customer {
  // champs existants…
  consentUpdatedAt  DateTime?
  consentSource     String?            // counter | phone | whatsapp_reply | portal | import | staff
  mergedIntoId      String?            // client cible après fusion
  anonymizedAt      DateTime?
  lastVisitAt       DateTime?          // dénormalisé (dernier OR livré ou facture), pour tri/filtre
  @@index([organizationId, phone2])
  @@index([organizationId, email])
  // index trigram (migration SQL) :
  // CREATE INDEX customer_display_name_trgm ON "Customer" USING gin ("displayName" gin_trgm_ops);
}

model Vehicle {
  // champs existants…
  plateCompact      String             // "2547GH01" — unicité et recherche
  plateType         PlateType @default(STANDARD)
  usage             VehicleUsage @default(PRIVATE)
  odometerOffset    Int       @default(0)      // après remplacement de compteur
  odometerInMiles   Boolean   @default(false)
  nextServiceTrigger String?                   // "DATE" | "MILEAGE"
  makeId            String?                    // lien catalogue (facultatif, make/model restent la vérité affichée)
  modelId           String?
  mergedIntoId      String?
  @@index([organizationId, plateCompact])
  @@index([organizationId, vin])
  // unicité partielle (migration SQL) :
  // CREATE UNIQUE INDEX vehicle_plate_unique ON "Vehicle" ("organizationId","plateCompact")
  //   WHERE "deletedAt" IS NULL AND "plateType" <> 'NONE';
  // CREATE INDEX vehicle_plate_trgm ON "Vehicle" USING gin ("plateCompact" gin_trgm_ops);
}
enum PlateType { STANDARD TEMPORARY DIPLOMATIC GOVERNMENT FOREIGN NONE OTHER }
enum VehicleUsage { PRIVATE TAXI TRANSPORT UTILITY RENTAL OTHER }

model MileageReading {
  // champs existants…
  isOutlier      Boolean  @default(false)
  createdAt      DateTime @default(now())
  @@index([vehicleId, readAt])
}

model CustomerNote {                    // notes internes datées (chronologie)
  id             String   @id @default(cuid())
  organizationId String
  customerId     String
  vehicleId      String?
  body           String
  pinned         Boolean  @default(false)
  createdById    String?
  createdAt      DateTime @default(now())
  deletedAt      DateTime?
  @@index([organizationId, customerId])
}

model DuplicateDismissal {              // paires de doublons ignorées
  id             String   @id @default(cuid())
  organizationId String
  entity         String                 // customer | vehicle
  idA            String                 // plus petit des deux id (ordre lexical)
  idB            String
  dismissedById  String?
  createdAt      DateTime @default(now())
  @@unique([organizationId, entity, idA, idB])
}

model CustomerSegment {                 // segments enregistrés (M10 campagnes, M12)
  id             String   @id @default(cuid())
  organizationId String
  name           String
  filters        Json                   // mêmes clés que customer.list / vehicle.list
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model VehicleMake {                     // catalogue ; organizationId null = catalogue global
  id             String  @id @default(cuid())
  organizationId String?
  name           String                 // "Toyota"
  isActive       Boolean @default(true)
  @@unique([organizationId, name])
}

model VehicleModel {
  id                    String  @id @default(cuid())
  organizationId        String?
  makeId                String
  name                  String          // "Corolla"
  yearFrom              Int?
  yearTo                Int?
  defaultFuel           FuelType?
  serviceIntervalKm     Int?            // 10000
  serviceIntervalMonths Int?            // 12
  isActive              Boolean @default(true)
  @@unique([makeId, organizationId, name])
}

model CustomerContact {
  // champs existants…
  phone2      String?
  isPrimary   Boolean  @default(false)
  createdAt   DateTime @default(now())
  deletedAt   DateTime?
}
```

Paramètres d'organisation ajoutés dans `Organization.settings` (M15) : `vehicles.defaultAvgKmPerDay` par usage, `vehicles.inspectionValidityMonths` par usage, `vehicles.defaultServiceIntervalKm`, `vehicles.defaultServiceIntervalMonths`.
