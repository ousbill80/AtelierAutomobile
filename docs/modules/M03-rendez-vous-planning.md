# M03 — Rendez-vous et planning atelier

> Priorité : **P1** · Dépend de : M01, M02 · Interagit avec : M04 (conversion en OR), M06 (affectation mécaniciens), M10 (rappels RDV, attribution des relances), M11 (confirmations, boîte de réception), M14 (prise de RDV en ligne), M17 (suggestion de créneau) · Rôles concernés : `ADVISOR`, `MANAGER`, `OWNER`, `CUSTOMER` (portail)

## 1. Objectif

Remplir l'atelier sans le surcharger. Aujourd'hui les rendez-vous sont notés dans un cahier ou dans le téléphone du réceptionnaire, les ponts sont tantôt vides, tantôt saturés, et les clients relancés pour leur VT qui répondent « oui samedi » ne sont pas convertis en visite. M03 centralise la prise de RDV quelle qu'en soit l'origine (comptoir, téléphone, WhatsApp, portail, relance), la répartit sur les ponts et les mécaniciens selon la capacité réelle, confirme et rappelle automatiquement, mesure les absences (no-show) et transforme le RDV en OR à l'arrivée du véhicule en un clic.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Prend les RDV au téléphone/comptoir/WhatsApp, confirme, accueille, convertit en OR, marque les absents | Quotidienne, plusieurs dizaines de fois |
| `MANAGER` | Organise le planning par pont et mécanicien (glisser-déposer), règle capacité et durées, bloque des créneaux | Quotidienne |
| `OWNER` | Consulte le remplissage de la semaine, le taux de no-show, les RDV issus des relances | Hebdomadaire |
| `MECHANIC` | Voit ses RDV/travaux prévus du jour (lecture, dans la PWA) | Quotidienne |
| `CUSTOMER` | Choisit un créneau depuis le lien d'une relance ou le portail, confirme, annule ou déplace | Ponctuelle |

## 3. User stories

**US-M03-01 — En tant que réceptionnaire, je veux créer un RDV au téléphone en moins d'une minute.**
- Étant donné l'écran planning, quand je clique sur un créneau libre (samedi 24/10/2026 09:00, Pont 1), alors un panneau latéral s'ouvre avec : client (recherche/création rapide), véhicule, type (`SERVICE` par défaut), durée proposée selon le type (90 min pour une révision), motif, source (`PHONE` présélectionnée si l'action vient du bouton « RDV téléphone »).
- Étant donné « Kouassi Jean-Marc / Toyota Corolla 2547 GH 01 / Révision », quand j'enregistre, alors un `Appointment` `BOOKED` est créé de 09:00 à 10:30 sur le Pont 1, `appointment.created` est émis, et une confirmation WhatsApp part (M11) : « Bonjour M. Kouassi, votre RDV chez Garage Excellence Auto est confirmé le samedi 24/10/2026 à 09:00 pour la révision de votre Toyota Corolla (2547 GH 01). Répondez 1 pour confirmer, 2 pour déplacer. »
- Étant donné que le client a une VT expirant dans moins de 30 jours ou une révision due, alors un encart propose « Ajouter : pré-visite technique (+30 min) » au RDV.

**US-M03-02 — En tant que réceptionnaire, je veux voir uniquement les créneaux réellement disponibles pour un type de travail.**
- Étant donné le type `DIAGNOSTIC` (60 min, pont de type `DIAGNOSTIC` requis), quand j'ouvre « Trouver un créneau », alors je vois les 10 prochains créneaux libres compatibles (pont adapté libre, capacité mécanicien suffisante, dans les horaires du site), triés par date.
- Étant donné un créneau qui chevauche une fermeture (dimanche, jour férié, pause 12:30-13:30 si configurée), alors il n'est pas proposé.

**US-M03-03 — En tant que chef d'atelier, je veux réorganiser le planning par glisser-déposer.**
- Étant donné la vue Jour par pont, quand je glisse le RDV de M. Koné du Pont 1 09:00 vers le Pont 2 11:00, alors `bayId`, `startsAt`, `endsAt` sont mis à jour, un contrôle de conflit est fait côté serveur, et si l'heure change, le client reçoit « Votre RDV a été déplacé au samedi 24/10/2026 à 11:00 » (case « Prévenir le client » cochée par défaut, décochable).
- Étant donné un dépôt sur un pont déjà occupé, alors le dépôt est refusé avec une animation de retour et le message « Pont 2 occupé de 10:30 à 12:00 (Bamba Aminata). » sauf si j'ai `planning:manage` et que je maintiens `Alt` (surréservation volontaire, marquée d'une icône ⚠ et tracée).
- Étant donné l'étirement du bord bas d'un RDV, alors sa durée change par pas de 15 min.

**US-M03-04 — En tant que chef d'atelier, je veux voir la charge par mécanicien afin d'équilibrer le travail.**
- Étant donné la vue « Mécaniciens », alors chaque colonne est un mécanicien présent ce jour-là, avec les RDV/OR qui lui sont affectés et une jauge « 6 h 30 planifiées / 8 h disponibles ».
- Étant donné un mécanicien absent (congé saisi dans `ResourceBlock`), alors sa colonne est grisée et l'affectation y est refusée.

**US-M03-05 — En tant que réceptionnaire, je veux transformer une réponse WhatsApp à une relance en RDV.**
- Étant donné une conversation (M11) où M. Kouassi répond « oui samedi matin » à la relance VT J-30, quand j'ouvre « Créer un RDV » depuis la conversation, alors client, véhicule, type `INSPECTION_PREP`, source `REMINDER` et `reminderId` sont pré-remplis, et M17 propose « Samedi 24/10 à 08:30, Pont 1 » (créneau libre le plus proche de l'intention détectée) que je peux accepter ou changer.
- Étant donné l'enregistrement, alors `appointment.created` est émis et M10 arrête la séquence VT pour ce véhicule (`stopOn` contient `appointment.created`), avec `Reminder.outcome = APPOINTMENT_BOOKED`.

**US-M03-06 — En tant que client, je veux choisir moi-même mon créneau depuis le lien reçu.**
- Étant donné le lien `{{lien.rdv}}` d'une relance (`/p/[token]/rdv`), alors je vois le garage, mon véhicule pré-identifié, le motif (« Révision »), et les créneaux disponibles des 14 prochains jours, par demi-journée, sans jamais voir le nom des autres clients.
- Étant donné le choix « Mardi 27/10 à 08:00 », quand je confirme, alors le RDV est créé avec `source = PORTAL` (ou `REMINDER` si le lien vient d'une relance, avec `reminderId`), statut `BOOKED` si l'organisation exige une validation du garage (`settings.appointments.portalRequiresApproval = true`), sinon `CONFIRMED` ; j'obtiens un écran de confirmation et un message WhatsApp/SMS.
- Étant donné un créneau pris entre-temps par un autre client, alors « Ce créneau vient d'être réservé. Choisissez-en un autre. » et la liste se rafraîchit.
- Étant donné un lien sans véhicule pré-identifié (portail général), alors je saisis mon nom, mon téléphone (OTP par WhatsApp/SMS pour éviter les faux RDV), ma plaque et le motif.

**US-M03-07 — En tant que client, je veux confirmer, déplacer ou annuler mon RDV par message.**
- Étant donné le rappel J-1 « … Répondez 1 pour confirmer, 2 pour déplacer, 3 pour annuler », quand je réponds « 1 », alors le statut passe `CONFIRMED` (M11 route la réponse vers `appointment.confirm`, `confirmedVia = whatsapp`).
- Étant donné « 2 » ou un texte libre (« je peux pas demain »), alors le RDV n'est pas modifié automatiquement : la conversation est marquée « RDV à replanifier » pour le réceptionnaire, M17 propose 3 créneaux de remplacement à envoyer en un clic, ou le lien de choix de créneau.
- Étant donné « 3 », alors le RDV passe `CANCELLED` (`cancelledBy = CUSTOMER`) et le réceptionnaire est notifié.

**US-M03-08 — En tant que réceptionnaire, je veux accueillir un client arrivé et ouvrir l'OR directement.**
- Étant donné le RDV de 09:00 de M. Kouassi, quand je clique « Client arrivé », alors le statut passe `ARRIVED`, `arrivedAt` est horodaté, et l'écran de réception M04 s'ouvre avec client, véhicule, doléances (motif du RDV) et `appointmentId` pré-remplis.
- Étant donné la réception validée dans M04, alors `Appointment.repairOrderId` est renseigné ; le RDV passe `COMPLETED` quand l'OR atteint `DELIVERED` (événement `repair_order.status_changed`).
- Étant donné un client arrivé sans RDV (« walk-in »), alors la réception M04 crée l'OR sans RDV ; aucun `Appointment` n'est fabriqué rétroactivement, mais l'OR est placé sur le planning comme bloc « Sans RDV » s'il est affecté à un pont.

**US-M03-09 — En tant que réceptionnaire, je veux marquer les absences et relancer les absents.**
- Étant donné un RDV `BOOKED`/`CONFIRMED` dont l'heure de début + 60 min (paramétrable) est dépassée sans arrivée, alors il apparaît en rouge « En retard / absent ? » ; à la fin de la journée (job 20:00), il passe automatiquement `NO_SHOW` si personne ne l'a traité.
- Étant donné un `NO_SHOW`, alors un message « Nous ne vous avons pas vu aujourd'hui. Souhaitez-vous reprogrammer votre révision ? {{lien.rdv}} » est proposé (validation manuelle par défaut) et le compteur `noShowCount` du client augmente.
- Étant donné un client avec ≥ 2 no-show sur 12 mois, alors un badge « 2 absences » s'affiche à la prise de RDV et la confirmation J-1 devient obligatoire (sans réponse à 18:00 la veille → appel suggéré dans la liste du jour).

**US-M03-10 — En tant que chef d'atelier, je veux régler la capacité et les durées standard.**
- Étant donné `/parametres/planning`, alors je règle : durée par type de RDV (§4 RG-M03-04), pas de grille (15 min), RDV simultanés maximum par demi-journée (ex. 6), marge d'accueil, créneaux ouverts au portail (types et plages), délai minimum de réservation en ligne (ex. 2 h), horizon (14 jours), jours fériés.
- Étant donné un blocage « Pont 2 en maintenance du 26/10 au 28/10 », alors aucun RDV ne peut y être posé et le portail n'en tient pas compte.

**US-M03-11 — En tant que gérant, je veux une vue semaine pour voir le remplissage.**
- Étant donné la vue Semaine, alors chaque jour affiche le nombre de RDV, le taux d'occupation des ponts (heures réservées / heures ouvertes) en jauge colorée (vert < 70 %, orange 70-90 %, rouge > 90 %), et la liste compacte des RDV.

**US-M03-12 — En tant que gestionnaire d'une flotte (via le réceptionnaire), je veux planifier les VT de plusieurs véhicules en une fois.**
- Étant donné SOTRA Logistique avec 4 véhicules dont la VT expire en novembre, quand je lance « Planifier en lot » depuis la fiche flotte (M02), alors je choisis un jour et l'outil répartit les 4 véhicules sur les créneaux libres (2 en parallèle max par défaut), crée 4 RDV liés par un `groupId`, et envoie **une seule** confirmation au responsable flotte listant les 4 plaques et heures.

## 4. Règles métier

**RG-M03-01 — Horaires.** Un RDV doit être entièrement dans les `Site.openingHours` du jour (format `{ mon: [["07:30","12:30"],["13:30","18:00"]], …, sun: [] }`), hors jours fériés (`settings.holidays`, liste de dates ; semence : jours fériés ivoiriens fixes — 01/01, 01/05, 07/08, 15/08, 01/11, 15/11, 25/12 — les fêtes mobiles (Pâques, Ascension, Pentecôte, Tabaski, Ramadan/Aïd el-Fitr, Maouloud, Lendemain de la Nuit du Destin) étant saisies chaque année par le gérant, avec rappel en décembre). Un `MANAGER` peut forcer un RDV hors horaires (badge « Hors horaires »).

**RG-M03-02 — Conflits.** Deux RDV ne peuvent se chevaucher sur un même `bayId` ; un mécanicien (`mechanicId`) ne peut avoir plus de RDV simultanés que 1. Les statuts `CANCELLED` et `NO_SHOW` ne bloquent pas. Un OR `IN_PROGRESS`/`WAITING_PARTS` occupant un pont (`RepairOrder.bayId`, cf. M04/M06) bloque ce pont jusqu'à `promisedAt` (ou fin de journée si absent). La vérification est **serveur** et transactionnelle (`SELECT … FOR UPDATE` sur les RDV du pont pour la plage, ou contrainte d'exclusion Postgres `EXCLUDE USING gist (bayId WITH =, tstzrange(startsAt, endsAt) WITH &&) WHERE status NOT IN ('CANCELLED','NO_SHOW') AND NOT overbooked`).

**RG-M03-03 — RDV sans pont.** Un RDV peut être créé sans `bayId` (« À affecter ») : il compte alors dans la capacité globale de la demi-journée (RG-M03-05) mais pas sur un pont. Le chef d'atelier l'affecte ensuite. Les RDV du portail sont créés sans pont par défaut sauf si `settings.appointments.autoAssignBay = true` (premier pont compatible libre).

**RG-M03-04 — Durées par type** (défaut, modifiables par site) :
| `AppointmentType` | Durée | Type de pont requis |
|---|---|---|
| `SERVICE` (révision/vidange) | 90 min | `LIFT` |
| `INSPECTION_PREP` (pré-visite technique) | 60 min | `LIFT` ou `DIAGNOSTIC` |
| `REPAIR` | 120 min | `LIFT` |
| `DIAGNOSTIC` | 60 min | `DIAGNOSTIC` |
| `BODYWORK` | 30 min (expertise/devis) | `BODYWORK` |
| `TIRES` | 45 min | `LIFT` ou `OTHER` |
| `OTHER` | 60 min | aucun |
Si le motif comporte des opérations du catalogue (`LaborOperation`) ou un devis accepté (M05), la durée proposée = somme des `standardHours` arrondie au quart d'heure supérieur, minimum la durée du type. Exemple : vidange (0,5 h) + plaquettes avant (1 h) + géométrie (0,75 h) = 2 h 15.

**RG-M03-05 — Capacité.**
- Capacité pont : heures d'ouverture du pont (non bloquées).
- Capacité atelier d'une demi-journée = `Σ heures disponibles des mécaniciens présents` × `settings.planning.productivityRate` (défaut 0,85).
- Charge = `Σ durée des RDV non annulés` de la demi-journée + travaux restants estimés des OR en cours.
- Un nouveau RDV est refusé (sauf forçage `planning:manage`) si charge + durée > capacité, ou si le nombre de RDV de la demi-journée ≥ `maxAppointmentsPerHalfDay` (défaut : nombre de ponts actifs × 2).
- Exemple : samedi matin 08:00-14:00, 3 mécaniciens présents → 3 × 6 h × 0,85 = 15,3 h de capacité ; déjà 12 h réservées → un RDV `REPAIR` de 2 h est accepté, un second refusé : « Atelier complet samedi matin (14 h / 15 h 18). »

**RG-M03-06 — Disponibilité mécaniciens.** Un mécanicien est disponible un jour donné si sa `Membership` est active, `MECHANIC` (ou `MANAGER` avec compétence atelier), rattachée au site, sans `ResourceBlock` couvrant la période. Ses heures = horaires du site (pas de planning individuel en v1, mais `ResourceBlock` permet absences et demi-journées). Les compétences (`Membership.skills`) servent de filtre et d'avertissement : affecter un RDV `BODYWORK` à un mécanicien sans compétence « carrosserie » affiche « Drissa n'a pas la compétence carrosserie » (non bloquant).

**RG-M03-07 — Créneaux exposés au portail** (`core/planning/availableSlots.ts`) :
```
Entrées : site, type, date de début, horizon (14 j), pas (30 min), RDV existants, blocages,
          OR en cours, capacité, délai minimum (2 h), plages portail
Pour chaque jour ouvré dans l'horizon :
  pour chaque début t aligné sur le pas, tel que [t, t+durée] ⊂ plage portail ∩ horaires :
    t ≥ now + délai minimum
    ∃ pont compatible libre sur [t, t+durée]  (si autoAssignBay) — sinon capacité de la demi-journée suffisante
    capacité restante de la demi-journée ≥ durée
Sortie : créneaux groupés par jour et demi-journée ; maximum 6 par demi-journée (répartis uniformément) pour ne pas dévoiler l'occupation exacte
```
Le portail ne montre que les types autorisés (`settings.appointments.portalTypes`, défaut : `SERVICE`, `INSPECTION_PREP`, `DIAGNOSTIC`, `TIRES`). La réservation re-vérifie la disponibilité en transaction.

**RG-M03-08 — Confirmations et rappels (délégués à M10/M11).**
- À la création : message de confirmation immédiat (transactionnel, envoyé même si le client est désinscrit des relances), sauf si l'heure est hors fenêtre d'envoi (22:00-07:00) → envoyé à 07:00.
- Rappel J-1 à 17:00 (règle `ReminderRule` de type `APPOINTMENT`, paliers par défaut : `J-1` à 17:00 ; `H-2` facultatif pour les RDV avant 10:00, envoyé la veille à 19:00 à la place).
- Un RDV créé moins de 24 h avant ne reçoit pas de J-1, seulement la confirmation.
- Modification d'horaire → message « déplacé » ; annulation par le garage → message « annulé » avec lien pour reprogrammer.
- `stopOn` de la règle `APPOINTMENT` : `appointment.cancelled`, `appointment.arrived`.
- Canal : celui du client (M11 : WhatsApp → SMS → email). Client sans WhatsApp ni SMS possible (fixe) → le RDV apparaît dans « Appels de confirmation à passer » de la veille.

**RG-M03-09 — Confirmation explicite.** `CONFIRMED` est atteint par : réponse « 1 »/« oui »/« ok »/« d'accord » (classée par M11/M17 avec confiance ≥ 0,9, sinon proposée au réceptionnaire), clic sur « Confirmer » dans le portail, saisie manuelle « Client a confirmé par téléphone ». `confirmedAt` et `confirmedVia` sont tracés.

**RG-M03-10 — No-show.**
- Seuil de retard : `settings.appointments.lateAfterMinutes` (défaut 60). Passage automatique en `NO_SHOW` par le job `appointments.mark_no_show` à 20:00 heure du site pour les RDV du jour encore `BOOKED`/`CONFIRMED`.
- `Customer.noShowCount12m` (calculé à la volée sur 12 mois glissants, mis en cache dans la fiche) ; ≥ 2 → badge et confirmation obligatoire.
- Un `NO_SHOW` issu d'une relance (`reminderId` non nul) relance la séquence d'origine à partir du palier suivant (M10, événement `appointment.no_show`).
- Correction : un `NO_SHOW` peut être repassé `ARRIVED` dans les 48 h (client arrivé mais non pointé) avec motif.

**RG-M03-11 — Annulation.** `cancelledBy` (`CUSTOMER` | `GARAGE`), `cancelReason` obligatoire pour le garage (liste : « Pièce non disponible », « Atelier surchargé », « Mécanicien absent », « Doublon », « Autre » + texte). Annulation impossible si statut `ARRIVED`/`COMPLETED` (on annule alors l'OR dans M04). Annulation client moins de 2 h avant : comptée comme « annulation tardive » (statistique, pas de pénalité en v1).

**RG-M03-12 — Attribution des relances.** Un RDV créé avec `reminderId` (lien de relance, réponse à une relance, ou création manuelle depuis la file des relances) ou créé dans les **14 jours** suivant l'envoi d'une relance VT/révision au même client pour le même véhicule est attribué à cette relance (`reminderId` rempli automatiquement si vide, `source` inchangée). Sert au KPI M12 « Clients revenus après un rappel ».

**RG-M03-13 — Un seul RDV actif par véhicule et par jour.** Créer un second RDV le même jour pour le même véhicule affiche « Ce véhicule a déjà un RDV le 24/10 à 09:00. Voulez-vous le modifier ? » (forçable).

**RG-M03-14 — RDV groupés (flotte).** `groupId` commun ; une seule confirmation et un seul rappel J-1 par contact destinataire, listant tous les véhicules ; annuler le groupe annule tous les RDV non arrivés.

**RG-M03-15 — Fuseau.** Toutes les heures affichées et saisies sont dans le fuseau de l'organisation (`Africa/Abidjan`, UTC+0, sans heure d'été) ; stockage UTC. Les calculs de créneaux utilisent `date-fns-tz`.

## 5. Machine à états

```
           ┌──────────── confirm ───────────┐
           │                                ▼
 [création] BOOKED ──────────────────────► CONFIRMED
           │   │                            │   │
           │   └──── arrive ──┐   ┌─ arrive ┘   │
           │                  ▼   ▼             │
           │                 ARRIVED ── OR livré ──► COMPLETED
           │                                    │
           ├── cancel ──► CANCELLED ◄── cancel ─┤
           └── no_show ─► NO_SHOW  ◄── no_show ─┘
                            │
                            └── arrive (≤ 48 h, motif) ──► ARRIVED
```

| Transition | Déclencheur | Permission | Effets |
|---|---|---|---|
| → `BOOKED` | `appointment.create` (staff, portail, API) | `appointment:create` (portail : jeton) | `appointment.created` ; M10 planifie J-1 ; confirmation envoyée |
| `BOOKED → CONFIRMED` | réponse client, portail, saisie | `appointment:update` | `appointment.updated` ; `confirmedAt` |
| `BOOKED/CONFIRMED → ARRIVED` | « Client arrivé » | `appointment:update` | `arrivedAt` ; ouverture réception M04 ; `appointment.arrived` (M10 arrête les rappels) |
| `ARRIVED → COMPLETED` | `repair_order.status_changed` → `DELIVERED` (ou `INVOICED`) | système | `appointment.completed` |
| `ARRIVED → COMPLETED` (sans OR) | « Terminer sans OR » (ex. simple contrôle gratuit) | `appointment:update` | motif requis |
| `BOOKED/CONFIRMED → CANCELLED` | garage ou client | `appointment:cancel` | `appointment.cancelled` ; message si demandé ; M10 annule rappels |
| `BOOKED/CONFIRMED → NO_SHOW` | job 20:00 ou manuel | `appointment:update` | `appointment.no_show` ; message de reprogrammation proposé |
| `NO_SHOW → ARRIVED` | correction ≤ 48 h | `appointment:update` | audit `appointment.no_show_reverted` |
| Modification d'horaire/pont | glisser-déposer, édition | `appointment:update` ; forçage : `planning:manage` | `appointment.updated` (`rescheduled: true`) ; M10 recalcule J-1 ; message « déplacé » si coché |

Tous les statuts terminaux (`COMPLETED`, `CANCELLED`) sont non modifiables (seules les notes restent éditables).

## 6. Données

Entités de `02` : `Appointment`, `Site` (`openingHours`), `Bay`, `Membership` (mécaniciens, `skills`), `Customer`, `Vehicle`, `Reminder` (`reminderId`), `RepairOrder` (`appointmentId`, `repairOrderId`), `LaborOperation` (durées), `Notification`.

Ajouts nécessaires (§14) : `Appointment.mechanicId`, `durationMinutes` implicite (calculée), `confirmedAt/confirmedVia`, `arrivedAt`, `cancelledAt/cancelledBy/cancelReason`, `groupId`, `overbooked`, `complaint` (motif structuré), `laborOperationIds`, `publicToken` ; `ResourceBlock` (indisponibilités ponts/mécaniciens/site) ; `RepairOrder.bayId` (occupation d'un pont par un OR, partagé avec M04/M06).

Paramètres (`Organization.settings.appointments` et `settings.planning`, édités dans M15 / `/parametres/planning`) :
```json
{
  "appointments": {
    "durations": { "SERVICE": 90, "INSPECTION_PREP": 60, "REPAIR": 120, "DIAGNOSTIC": 60, "BODYWORK": 30, "TIRES": 45, "OTHER": 60 },
    "slotStepMinutes": 15, "lateAfterMinutes": 60, "noShowJobTime": "20:00",
    "portalEnabled": true, "portalTypes": ["SERVICE","INSPECTION_PREP","DIAGNOSTIC","TIRES"],
    "portalRequiresApproval": false, "portalMinLeadHours": 2, "portalHorizonDays": 14,
    "autoAssignBay": false, "maxAppointmentsPerHalfDay": null
  },
  "planning": { "productivityRate": 0.85, "lunchBreak": ["12:30","13:30"] },
  "holidays": ["2026-12-25", "2027-01-01"]
}
```

## 7. Écrans et interface

| Route | Contenu | Actions | Mobile |
|---|---|---|---|
| `/(app)/rendez-vous` | **Planning**. Barre : sélecteur de date (◀ Aujourd'hui ▶), vue (Jour par pont · Jour par mécanicien · Semaine · Liste), filtres (type, statut, source). Grille horaire (pas 15 min) avec colonnes = ponts actifs (+ colonne « À affecter »). Carte RDV : heure, nom client, modèle + plaque, type (pastille couleur), statut (icône + texte), source (icône : téléphone, WhatsApp, portail, cloche = relance), badges (⚠ surréservation, absences antérieures, VT bientôt). Bandeau en haut : capacité de la demi-journée (jauge). Blocs gris hachurés : blocages, fermetures, OR en cours occupant un pont. | Clic sur créneau vide → création ; clic sur RDV → panneau détail ; glisser-déposer ; redimensionner ; « Nouveau RDV » ; « Trouver un créneau » | Vue Liste par défaut (cartes chronologiques groupées par demi-journée), bascule Jour par pont avec défilement horizontal ; glisser-déposer remplacé par « Déplacer » (formulaire) |
| Panneau « RDV » (latéral) | Client (lien fiche, Appeler, WhatsApp), véhicule (VT/révision), type, motif/doléances, opérations prévues, durée, pont, mécanicien, conseiller, source et relance d'origine, historique des messages liés (confirmation, rappel, réponse) | Confirmer, Client arrivé (→ réception M04), Déplacer, Annuler (motif), Marquer absent, Envoyer un rappel maintenant, Ouvrir l'OR | Plein écran |
| `/(app)/rendez-vous/aujourdhui` | Liste du jour pour l'accueil : à venir, en retard (rouge), arrivés, absents ; compteur « 9 RDV · 6 confirmés · 2 sans réponse » ; section « Confirmations à obtenir par téléphone » (clients sans canal ou sans réponse la veille) | Client arrivé, Appeler, Marquer confirmé, Marquer absent | Écran principal mobile de l'accueil |
| `/(app)/rendez-vous/nouveau` | Formulaire complet (même contenu que le panneau), avec assistant « Trouver un créneau » (liste des 10 prochains créneaux compatibles) et suggestion IA | Enregistrer, Enregistrer et envoyer la confirmation | Une colonne |
| `/(app)/parametres/planning` | Durées par type, pas, capacité, productivité, pause, portail (types, délai, horizon, validation), jours fériés (calendrier annuel), blocages (liste + création : pont / mécanicien / site entier, période, motif) | Enregistrer | |
| `/p/[token]/rdv` (portail public) | En-tête garage (logo, adresse, téléphone), véhicule identifié ou formulaire (nom, téléphone + OTP, plaque, motif), choix du jour (bandeau de 14 jours, jours complets grisés), créneaux par matin/après-midi, récapitulatif, champ commentaire | Réserver ; sur un RDV existant : Confirmer, Déplacer, Annuler | Mobile d'abord, cibles ≥ 44 px, page < 100 Ko |
| `/(tech)/aujourdhui` (PWA, lecture) | Pour le mécanicien : ses RDV/véhicules attendus du jour (heure, véhicule, motif) | — | Tablette/téléphone |

**Couleurs par type** (pastille + libellé, jamais la couleur seule) : Révision bleu, Pré-VT violet, Réparation orange, Diagnostic cyan, Carrosserie rouge brique, Pneus gris ardoise, Autre gris.
**Statuts** : Réservé (gris, horloge), Confirmé (vert, coche), Arrivé (bleu, voiture), Terminé (vert foncé, drapeau), Absent (rouge, croix), Annulé (gris barré).
**États** : planning vide → « Aucun RDV ce jour. Les relances VT et révision vont remplir votre agenda. » ; erreur de conflit → toast rouge avec le RDV en conflit ; chargement → squelette de grille.

## 8. API

| Procédure | Entrée | Sortie |
|---|---|---|
| `appointment.list` | `{ siteId, from, to, bayIds?, mechanicIds?, statuses?, types?, sources? }` | `Appointment[]` enrichis (client, véhicule, flags) + `blocks: ResourceBlock[]` + `occupyingOrders[]` |
| `appointment.get` | `{ id }` | RDV + client + véhicule + messages liés + relance d'origine |
| `appointment.create` | `{ siteId, customerId, vehicleId?, type, startsAt, durationMinutes?, bayId?, mechanicId?, advisorId?, complaint?, laborOperationIds?, source, reminderId?, notes?, notifyCustomer=true, force? }` | RDV — erreurs `SLOT_CONFLICT { conflictingId }`, `OUTSIDE_OPENING_HOURS`, `CAPACITY_EXCEEDED { load, capacity }`, `DUPLICATE_SAME_DAY` |
| `appointment.update` | `{ id, startsAt?, durationMinutes?, bayId?, mechanicId?, type?, complaint?, notes?, notifyCustomer?, force? }` | RDV |
| `appointment.confirm` | `{ id, via: 'phone' \| 'whatsapp' \| 'sms' \| 'portal' \| 'in_person' }` | RDV |
| `appointment.markArrived` | `{ id }` | `{ appointment, receptionUrl }` |
| `appointment.complete` | `{ id, reason }` (sans OR) | RDV |
| `appointment.cancel` | `{ id, cancelledBy, reason, notifyCustomer=true }` | RDV |
| `appointment.markNoShow` / `appointment.revertNoShow` | `{ id }` / `{ id, reason }` | RDV |
| `appointment.sendReminderNow` | `{ id }` | `{ messageId }` |
| `appointment.createBatch` | `{ siteId, customerId, date, vehicleIds[], type, maxParallel=2 }` | `{ groupId, appointments[], unplaced: vehicleId[] }` |
| `planning.availableSlots` | `{ siteId, type, durationMinutes?, from, days≤31, bayType?, mechanicId? }` | `{ date, halfDay, slots: { startsAt, bayId? }[] }[]` |
| `planning.capacity` | `{ siteId, from, to }` | `{ date, halfDay, capacityMinutes, loadMinutes, appointmentsCount }[]` |
| `planning.suggestSlot` | `{ conversationId? , customerId, vehicleId?, type, preferredText? }` | `{ suggestions: { startsAt, bayId, reason }[], aiInteractionId }` (M17) |
| `resourceBlock.list/create/delete` | `{ siteId, bayId?, membershipId?, startsAt, endsAt, reason }` | bloc — erreur `BLOCK_HAS_APPOINTMENTS { ids }` (proposer de déplacer) |
| `planningSettings.get/update` | objet §6 | paramètres |

**Portail public** (procédures `portal.*`, authentifiées par jeton à portée limitée, cf. M14) : `portal.appointment.slots { token, type? }`, `portal.appointment.book { token, startsAt, type, comment?, otpProof? }`, `portal.appointment.get { token }`, `portal.appointment.confirm/cancel/reschedule { token, startsAt? }`. Limitation de débit : 10 réservations/heure/IP, 3/jour/téléphone.

**REST public** (M13, scope `appointments:read/write`) : `GET /api/v1/appointments?from&to&siteId`, `POST /api/v1/appointments`, `PATCH /api/v1/appointments/{id}`, `GET /api/v1/availability?siteId&type&from&days`.

## 9. Automatisations et événements

**Émis** : `appointment.created`, `appointment.updated` (`{ rescheduled, previousStartsAt }`), `appointment.confirmed`, `appointment.arrived`, `appointment.cancelled`, `appointment.no_show`, `appointment.completed`.
| Consommateur | Usage |
|---|---|
| M10 | planifie/recalcule/annule les rappels `APPOINTMENT` ; arrête les séquences VT/révision/devis (`stopOn`) ; outcome `APPOINTMENT_BOOKED` ; reprise après no-show |
| M11 | confirmations, messages « déplacé/annulé », association des réponses 1/2/3 au RDV |
| M04 | ouverture de la réception à `appointment.arrived` |
| M12 | taux de remplissage, no-show, RDV par source, RDV attribués aux relances |

**Consommés** : `repair_order.status_changed` (→ `COMPLETED` à `DELIVERED`/`INVOICED`) ; `message.inbound_received` classé `APPOINTMENT_CONFIRM` / `APPOINTMENT_RESCHEDULE` / `APPOINTMENT_CANCEL` (M11/M17) ; `member.deactivated` (désaffectation des RDV futurs du mécanicien + notification au chef d'atelier) ; `quote.accepted` (proposition de planifier les travaux acceptés : notification « Planifier les travaux du devis DEV-YOP-2026-00017 (3 h 15) »).

**Worker** : `appointments.mark_no_show` (toutes les 15 min, traite les sites dont l'heure locale a dépassé `noShowJobTime`) ; `appointments.daily_agenda` (07:00) — envoie au chef d'atelier et aux conseillers l'agenda du jour (notification + WhatsApp optionnel) ; `appointments.unconfirmed_check` (18:00) — liste des RDV du lendemain non confirmés → « Appels à passer ».

**IA (M17)** : suggestion de créneau à partir d'un message libre (« samedi matin », « après la paie ») ; estimation de durée à partir des doléances (« bruit au freinage et vidange » → 2 h) ; prédiction de risque de no-show (historique, délai de réservation, source) affichée en badge « Risque d'absence élevé » pour inciter à confirmer par appel. Toutes ces suggestions sont acceptées ou modifiées par l'humain.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir le planning, les RDV | `appointment:read` | OWNER, MANAGER, ADVISOR, MECHANIC (ses RDV seulement en `(tech)`), CASHIER |
| Créer un RDV | `appointment:create` | OWNER, MANAGER, ADVISOR |
| Modifier, confirmer, marquer arrivé/absent, déplacer | `appointment:update` | OWNER, MANAGER, ADVISOR |
| Annuler | `appointment:cancel` | OWNER, MANAGER, ADVISOR |
| Forcer (surréservation, hors horaires, capacité), blocages, paramètres planning, RDV groupés | `planning:manage` | OWNER, MANAGER |
| Réserver depuis le portail | jeton public (M14) | CUSTOMER |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Deux réceptionnaires réservent le même créneau en même temps | Le second reçoit `SLOT_CONFLICT` : « Ce créneau vient d'être pris par Bamba Aminata. » ; la grille se rafraîchit. |
| Client sans véhicule enregistré (« je viens avec la voiture de ma femme ») | `vehicleId` facultatif ; badge « Véhicule à identifier » ; obligatoire à la réception (M04). |
| Client sans WhatsApp ni mobile | Pas de confirmation écrite ; ligne dans « Confirmations à obtenir par téléphone ». |
| Coupure de courant / panne de pont le jour J | Blocage « Pont 1 indisponible » créé à l'instant : les RDV en conflit sont listés avec « Réaffecter automatiquement » (premier pont compatible libre) ou « Prévenir les clients » (message de report avec lien). |
| Mécanicien absent le matin même | Création d'un `ResourceBlock` ; ses RDV passent « À affecter » avec notification au chef d'atelier ; la capacité est recalculée (alerte si dépassée). |
| Client arrive avec 2 h de retard | « Client arrivé » reste possible tant que le statut n'est pas `NO_SHOW` ; si le pont est occupé, le RDV est déplacé dans « À affecter ». |
| RDV pris pour un véhicule déjà dans l'atelier (OR ouvert) | Avertissement « Ce véhicule est déjà à l'atelier (OR-YOP-2026-00042, statut En cours). » |
| Relance VT répondue « oui » mais le client ne précise pas de jour | Pas de RDV créé ; M17 propose de répondre avec 3 créneaux ou le lien `{{lien.rdv}}`. |
| Jour férié mobile non saisi (ex. Tabaski) | Le gérant l'ajoute ; les RDV déjà posés ce jour-là sont listés avec « Prévenir et déplacer ». |
| Portail : client qui réserve 5 créneaux | Limite 3 RDV futurs actifs par téléphone via le portail ; au-delà : « Vous avez déjà 3 RDV. Appelez-nous au 07 08 12 34 56. » |
| Lien de relance expiré (jeton > 30 j) | Page « Ce lien a expiré » + bouton « Prendre RDV » (portail général avec OTP) et numéro du garage. |
| Changement d'horaires d'ouverture avec des RDV futurs hors des nouvelles plages | À l'enregistrement : « 7 RDV futurs sont hors des nouveaux horaires » avec liste et action groupée. |
| Site en mode `REMINDERS_ONLY` | Le planning reste disponible (prise de RDV issue des relances), la conversion en OR est remplacée par « Terminé » (l'OR est fait dans l'ancien logiciel). |

## 12. Tests

**Unitaires (`core/planning`)** : `isWithinOpeningHours` (pause midi, samedi demi-journée, dimanche, jour férié) ; `detectConflicts` (chevauchement exact, bord à bord autorisé 09:00-10:30 / 10:30-12:00, statuts ignorés) ; `computeCapacity` (exemple RG-M03-05 : 15,3 h, refus à 16 h) ; `defaultDuration` (somme des `standardHours` arrondie au quart d'heure : 2,25 h → 135 min) ; `availableSlots` (délai minimum 2 h, horizon, maximum 6 par demi-journée, pont compatible) ; `attributeReminder` (fenêtre de 14 jours, même véhicule) ; `noShowEligibility` (seuil 60 min, job 20:00 en heure locale) ; `batchPlacement` (4 véhicules, 2 en parallèle).

**Intégration** : contrainte d'exclusion Postgres sur deux insertions concurrentes ; flux relance → RDV (`reminderId`, arrêt de la séquence M10, outcome) ; réponse WhatsApp « 1 » → `CONFIRMED` ; `NO_SHOW` automatique ; `repair_order.status_changed` → `COMPLETED` ; portail : réservation par jeton, revalidation de disponibilité, limitation de débit ; isolation multi-locataire et portée par site (un `ADVISOR` limité à YOP ne voit pas le planning COC).

**E2E Playwright** : le réceptionnaire crée un RDV révision pour Kouassi Jean-Marc samedi 09:00 Pont 1 → vérifie la confirmation dans `/dev/outbox` → glisse le RDV sur Pont 2 11:00 (message « déplacé ») → le client ouvre le lien portail et confirme → le jour J, « Client arrivé » ouvre la réception M04 pré-remplie → l'OR livré fait passer le RDV `COMPLETED`.

## 13. Définition de « terminé »

- [ ] `core/planning` (horaires, conflits, capacité, durées, créneaux, attribution, placement groupé) avec tests.
- [ ] Contrainte d'exclusion (ou verrou transactionnel) empêchant les doubles réservations ; extension `btree_gist` activée.
- [ ] Planning Jour par pont / par mécanicien / Semaine / Liste, glisser-déposer et redimensionnement (`@dnd-kit` ou FullCalendar ressources), version mobile en liste.
- [ ] Écran « Aujourd'hui » de l'accueil, panneau RDV, paramètres planning, blocages, jours fériés.
- [ ] Confirmations, rappels J-1, messages déplacé/annulé branchés sur M10/M11 ; réponses 1/2/3 traitées.
- [ ] Portail `/p/[token]/rdv` fonctionnel avec OTP et limitation de débit.
- [ ] No-show automatique, badge d'absences, reprise de séquence de relance.
- [ ] Conversion RDV → réception M04 → `COMPLETED`.
- [ ] Événements émis/consommés idempotents ; endpoints REST documentés ; E2E vert.

## 14. Évolutions du modèle de données

```prisma
model Appointment {
  // champs existants…
  mechanicId       String?                     // Membership.id du mécanicien prévu
  complaint        String?                     // motif / doléances (repris dans l'OR)
  laborOperationIds String[]                   // opérations prévues (durée, devis)
  quoteId          String?                     // RDV planifié pour exécuter un devis accepté
  confirmedAt      DateTime?
  confirmedVia     String?                     // phone | whatsapp | sms | portal | in_person
  arrivedAt        DateTime?
  cancelledAt      DateTime?
  cancelledBy      String?                     // CUSTOMER | GARAGE
  cancelReason     String?
  noShowAt         DateTime?
  groupId          String?                     // RDV groupés (flotte)
  overbooked       Boolean  @default(false)    // surréservation volontaire
  outsideHours     Boolean  @default(false)
  publicToken      String?  @unique            // lien portail (confirmer/déplacer/annuler)
  createdById      String?
  @@index([organizationId, siteId, startsAt])
  @@index([organizationId, customerId])
  @@index([organizationId, status, startsAt])
  // Migration SQL (extension btree_gist) :
  // ALTER TABLE "Appointment" ADD CONSTRAINT appointment_no_overlap
  //   EXCLUDE USING gist ("bayId" WITH =, tstzrange("startsAt","endsAt") WITH &&)
  //   WHERE ("bayId" IS NOT NULL AND status NOT IN ('CANCELLED','NO_SHOW') AND NOT overbooked);
}

model ResourceBlock {                          // indisponibilités : pont, mécanicien ou site entier
  id             String   @id @default(cuid())
  organizationId String
  siteId         String
  bayId          String?
  membershipId   String?                       // mécanicien absent
  startsAt       DateTime
  endsAt         DateTime
  reason         String                        // "Maintenance pont", "Congé", "Formation"
  createdById    String?
  createdAt      DateTime @default(now())
  @@index([organizationId, siteId, startsAt])
}

model RepairOrder {
  // champ partagé avec M04/M06 : occupation d'un pont par un OR en cours
  bayId          String?
}

model Bay {
  // champs existants…
  sortOrder      Int     @default(0)           // ordre des colonnes du planning
  color          String?
}
```

Paramètres ajoutés dans `Organization.settings` : `appointments.*`, `planning.*`, `holidays` (voir §6). Règle `ReminderRule` par défaut de type `APPOINTMENT` (paliers `J-1` 17:00, `H-2` facultatif) semée par M01/M10.
