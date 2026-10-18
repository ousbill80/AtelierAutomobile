# M14 — Portail client

> Priorité : P1 (page devis livrée avec M05 en étape 3.3, page facture/paiement avec M08 en étape 4.3) · Dépend de : M02, M03, M04, M05, M06, M08, M09, M10, M11, M15 · Rôles concernés : CUSTOMER (client final, sans compte), ADVISOR, OWNER

## 1. Objectif

Le client du garage n'installe rien et ne crée aucun compte : il reçoit un **lien court** par WhatsApp/SMS/email et peut, depuis son téléphone, approuver un devis ligne par ligne et signer, payer sa facture par Wave/Orange Money/MTN/Moov, suivre son véhicule dans l'atelier, gérer son rendez-vous, consulter l'historique et les prochaines échéances, et donner son avis. Les accords deviennent traçables (fin des contestations), les paiements arrivent plus vite et la réception reçoit moins d'appels « c'est prêt ? ». Les pages sont **mobile-first** et utilisables en 3G.

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| Client particulier | Ouvre le lien du devis, accepte/refuse, signe ; paie la facture ; suit l'OR ; confirme/annule son RDV | À chaque passage |
| Client entreprise (responsable flotte) | Vue flotte : véhicules, échéances, factures ouvertes, relevé ; approuve les devis de ses véhicules | Hebdomadaire |
| ADVISOR | Génère/renvoie un lien, voit si le client l'a ouvert, révoque un lien | Quotidien |
| OWNER | Configure le portail (couleurs, modules visibles, avis Google), lit les avis | Mensuel |

## 3. User stories

**US-M14-01 — En tant que client, je veux approuver mon devis ligne par ligne depuis mon téléphone afin de ne payer que ce que je choisis.**
- Étant donné le devis DEV-YOP-2026-00017 (3 lignes : plaquettes avant **urgent** 48 000 FCFA, disques avant **à surveiller** 96 000 FCFA, vidange 35 000 FCFA ; total 179 000 FCFA TTC) envoyé à M. Kouassi, quand il ouvre `/p/{token}`, alors il voit les lignes groupées par priorité (Urgent, À surveiller, Entretien) avec photos de l'inspection, chacune avec un interrupteur « Je veux » (lignes non optionnelles pré-cochées), et le total mis à jour en direct.
- Quand il décoche les disques et touche « Valider mon choix », alors une étape de signature s'affiche (nom pré-rempli, zone de signature au doigt, case « J'accepte les travaux sélectionnés pour 83 000 FCFA TTC ») ; après validation, `Quote.status = PARTIALLY_ACCEPTED`, `QuoteLine.accepted` renseignés, `decisionChannel = "portal"`, signature stockée, événement `quote.accepted` émis, et l'écran affiche « Merci, l'atelier a reçu votre accord ».

**US-M14-02 — En tant que client, je veux refuser un devis en donnant une raison.**
- Quand je touche « Je refuse ce devis », alors je choisis un motif (Trop cher · Je vais réfléchir · Je fais réparer ailleurs · Autre + texte) ; `Quote.status = DECLINED`, `declineReason` rempli, `quote.declined` émis.

**US-M14-03 — En tant que client, je veux payer ma facture par mobile money.**
- Étant donné la facture FAC-2026-000412 de 185 000 FCFA (solde 185 000), quand j'ouvre le lien, alors je vois la facture (lignes, TVA, total), le **QR code FNE** et le n° FNE si certifiée, et un bouton « Payer 185 000 FCFA ».
- Quand je choisis Wave, alors un `PaymentLink` est créé via M08 (`payments.createLink`) et je suis redirigé vers la page Wave ; au retour, la page affiche « Paiement en cours de vérification… » puis « Payé ✓ — Reçu REC-2026-000310 » dès réception du webhook (interrogation toutes les 3 s pendant 2 min).
- Étant donné que `settings.portal.allowPartialPayment = true`, alors je peux saisir un montant ≥ `max(5 000, 10 % du solde)` FCFA.

**US-M14-04 — En tant que client, je veux suivre mon véhicule en temps réel.**
- Étant donné l'OR OR-YOP-2026-00042 en `IN_PROGRESS`, quand j'ouvre le lien de suivi, alors je vois une frise (Reçu → Diagnostic → En attente de votre accord → En réparation → Contrôle qualité → Prêt → Restitué), l'étape courante, la date promise, les photos de réception et les points d'inspection (vert/orange/rouge avec libellé), et les remarques marquées « visible client » (M06).
- Quand l'OR passe à `READY`, alors la page se met à jour en moins de 30 s sans rechargement et affiche « Votre véhicule est prêt » avec le bouton de paiement si une facture existe.

**US-M14-05 — En tant que client relancé pour sa VT, je veux prendre rendez-vous moi-même.**
- Étant donné le lien `{{lien.rdv}}` d'une relance VT, quand je l'ouvre, alors je vois mon véhicule (Toyota Corolla, 2547 GH 01), le motif pré-sélectionné (Pré-visite technique), et les créneaux disponibles des 14 prochains jours calculés par M03 (`appointments.availableSlots`).
- Quand je choisis samedi 24/10/2026 09:00 et confirme, alors un `Appointment` `source = PORTAL`, `status = BOOKED`, `reminderId` = relance d'origine est créé, les relances VT s'arrêtent (`appointment.created`), et je reçois une confirmation WhatsApp avec lien d'annulation.

**US-M14-06 — En tant que client, je veux confirmer, déplacer ou annuler mon RDV.**
- Étant donné un RDV `BOOKED` et le rappel J-1 contenant le lien, quand je touche « Je confirme », alors `status = CONFIRMED`. « Déplacer » propose les créneaux ; « Annuler » demande un motif et passe `CANCELLED`. Une annulation à moins de `settings.portal.cancelCutoffHours` (défaut 2 h) est refusée : « Merci d'appeler le garage au 07 08 12 34 56 ».

**US-M14-07 — En tant que client, je veux voir l'historique et les échéances de mon véhicule.**
- Étant donné le lien véhicule, alors je vois : prochaine VT (date + compte à rebours), prochaine révision (date ou km estimé), assurance, et la liste des passages (date, km, travaux résumés, montant, lien facture PDF).

**US-M14-08 — En tant que client, je veux accéder à tout mon historique avec mon numéro de téléphone.**
- Étant donné `/p/connexion`, quand je saisis 07 47 21 88 90, alors si ce numéro correspond à un ou plusieurs `Customer` de **ce garage**, un OTP à 6 chiffres est envoyé par WhatsApp (repli SMS) ; après saisie, j'accède à `/p/compte` (véhicules, devis, factures, RDV, relevé) pendant 30 jours sur cet appareil.
- Étant donné un numéro inconnu, alors le message est identique (« Si ce numéro est enregistré, vous allez recevoir un code ») pour ne pas révéler l'existence d'un client.

**US-M14-09 — En tant que responsable flotte de SOTRA Logistique, je veux une vue d'ensemble de mes 12 véhicules.**
- Étant donné un `CustomerContact` avec `portalAccess = true` (« Responsable flotte »), après OTP, alors `/p/compte/flotte` affiche le tableau des véhicules (plaque, n° flotte, conducteur, km estimé, VT, révision, OR en cours, statut), filtrable, avec export CSV, le total dû (1 240 000 FCFA), les factures ouvertes et les devis en attente d'approbation.

**US-M14-10 — En tant que client, je veux télécharger mon relevé de compte.**
- Quand je touche « Relevé de compte », alors un PDF (M09 `statement`) liste factures, paiements et solde sur la période choisie (3 / 6 / 12 mois).

**US-M14-11 — En tant que client, je veux donner mon avis après la restitution.**
- Étant donné la relance `SATISFACTION` envoyée 24 h après `deliveredAt`, quand j'ouvre le lien, alors je note de 1 à 5 étoiles et ajoute un commentaire facultatif ; une note ≤ 3 crée une notification au gérant ; une note ≥ 4 propose « Laisser un avis sur Google » si `settings.portal.googleReviewUrl` est renseigné.

## 4. Règles métier

### 4.1 Jetons et sécurité

- **RG-M14-01 — Jeton.** 32 octets aléatoires (`crypto.randomBytes`) encodés base64url (43 caractères). Stocké **haché** (`sha256`) dans `PortalToken.tokenHash` ; le clair n'existe que dans le lien envoyé. `Quote.publicToken` et `Invoice.publicToken` de 02 contiennent le **hash** (pas le clair) et pointent vers le même mécanisme pour compatibilité.
- **RG-M14-02 — Portée.** Chaque jeton a un `scope` et une cible unique : `QUOTE` (un devis), `INVOICE` (une facture), `REPAIR_ORDER` (suivi d'un OR + ses devis/factures), `APPOINTMENT` (un RDV), `BOOKING` (prise de RDV pour un client et éventuellement un véhicule), `VEHICLE` (historique d'un véhicule), `STATEMENT` (relevé d'un client), `SURVEY` (avis sur un OR). Un jeton ne donne **jamais** accès à une autre ressource que sa cible et ses enfants directs.
- **RG-M14-03 — Expiration par défaut** : QUOTE = `validUntil + 30 j` ; INVOICE = 180 j après émission ou 30 j après paiement complet ; REPAIR_ORDER = 30 j après `deliveredAt` ; APPOINTMENT = `startsAt + 1 j` ; BOOKING = 30 j ; VEHICLE et STATEMENT = 90 j ; SURVEY = 14 j. Jeton expiré → page « Ce lien a expiré » + bouton « Recevoir un nouveau lien » (renvoie un nouveau lien au **numéro enregistré** du client, jamais à un numéro saisi), limité à 3 demandes/jour.
- **RG-M14-04 — Révocation** : par le personnel (`portal.revokeToken`), automatique quand le devis passe à une nouvelle version (l'ancien lien affiche « Ce devis a été mis à jour » et redirige vers la nouvelle version si le client a un jeton actif), quand une facture est annulée (`VOID` : « Cette facture a été annulée »), ou quand le client est supprimé.
- **RG-M14-05 — Lien court.** Les messages utilisent `https://{domaine}/p/{token}` (43 car.). Pour les SMS, un alias court `https://{domaine}/l/{code}` (8 caractères base62, `PortalToken.shortCode`) redirige (302) vers le lien complet. Domaine portail configurable (`settings.portal.domain`, défaut `app.atelieros.ci`).
- **RG-M14-06 — Protection.** Limitation de débit : 30 requêtes/min par IP sur `/p/*`, 5 jetons invalides/10 min par IP → blocage 30 min. Pages en `noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`. Aucune donnée d'un autre client dans la page. Téléphone affiché masqué (`+225 07 •• •• 88 90`). Chaque ouverture enregistre `PortalAccess` (date, IP tronquée /24, user-agent) ; la première ouverture d'un devis met `Quote.viewedAt` et `status = VIEWED`.
- **RG-M14-07 — Actions à effet** (accepter un devis, annuler un RDV, payer) : jeton CSRF lié au jeton portail + protection rejeu (une décision de devis ne peut être soumise qu'une fois ; deuxième soumission → affichage de la décision existante).

### 4.2 Devis

- **RG-M14-08 — Affichage.** Lignes regroupées par `QuoteLine.priority` (URGENT → « À faire rapidement », WATCH → « À surveiller », null → « Travaux et entretien ») ; MO et pièces d'un même point regroupées sous le libellé du point d'inspection lorsqu'elles sont liées ; prix TTC par ligne ; remise affichée ; explication en langage simple (M17 `ai.explainQuote`, si activée, validée par le conseiller avant envoi) dépliable sous chaque groupe.
- **RG-M14-09 — Calcul du total accepté** : `Σ lineTotal des lignes cochées` calculé par `core/money` (mêmes règles d'arrondi que M05) ; si `insuranceShare > 0`, afficher « Part assurance » et « Reste à votre charge = customerShare recalculé ».
- **RG-M14-10 — Lignes obligatoires.** Une ligne non optionnelle dont dépend une autre (ex. MO de pose liée à une pièce via `sortOrder` de groupe M05) se coche/décoche avec elle. Si aucune ligne cochée → bouton « Valider » désactivé, proposer « Je refuse ce devis ».
- **RG-M14-11 — Signature.** Obligatoire si `settings.portal.requireSignature = true` (défaut). Canvas → PNG ≤ 200 Ko stocké S3 (`Attachment` `entity = quote`, `kind = signature`), `Quote.signatureUrl`, `signerName`, `decidedAt`. Le PDF du devis accepté (M05) inclut signature, date, heure, IP tronquée, empreinte `sha256` du contenu des lignes acceptées.
- **RG-M14-12 — Devis expiré** (`validUntil < aujourd'hui`) : lecture seule, bandeau « Ce devis a expiré le 25/10/2026. Contactez le garage pour le mettre à jour. » + bouton WhatsApp vers `Site.whatsappNumber`.

### 4.3 Facture et paiement

- **RG-M14-13 — Contenu.** En-tête garage (logo, nom légal, RCCM, NCC, adresse), n° facture (ou `externalNumber` si importée), dates, véhicule, lignes, sous-total, remise, TVA, total, déjà payé, **solde**, QR FNE (`Invoice.fneQrCode` rendu en SVG) + `fneNumber` si `fneStatus ∈ {CERTIFIED, MANUAL}` ; sinon mention « Facture en cours de certification ». Bouton « Télécharger le PDF » (M08).
- **RG-M14-14 — Bouton payer.** Visible si `balance > 0`, statut ∉ {VOID, DISPUTED, WRITTEN_OFF} et au moins un `PaymentProviderConfig` actif ; liste des moyens = union des `methods` des fournisseurs actifs, dans l'ordre Wave, Orange Money, MTN MoMo, Moov Money, Carte. Un `PaymentLink` `PENDING` non expiré du même montant est **réutilisé**. Sinon affichage des numéros marchands (`{{paiement.wave}}`…) avec « Indiquez FAC-2026-000412 en référence ».
- **RG-M14-15 — Confirmation.** La page ne déclare jamais « Payé » sur la seule redirection du fournisseur : seul un `Payment` `CONFIRMED` (webhook ou `payments.reconcile`) fait foi. Après 2 min sans confirmation : « Nous n'avons pas encore reçu la confirmation. Si vous avez été débité, ne repayez pas : le garage est prévenu. » + notification au caissier.

### 4.4 Suivi d'OR

- **RG-M14-16 — Correspondance des statuts** (libellés client) :

| `RepairOrderStatus` | Étape affichée |
|---|---|
| DRAFT, CHECKED_IN | Véhicule reçu |
| DIAGNOSING | Diagnostic en cours |
| AWAITING_APPROVAL | En attente de votre accord (lien vers le devis) |
| APPROVED, IN_PROGRESS | En réparation |
| WAITING_PARTS | En attente de pièces |
| QUALITY_CHECK | Contrôle final |
| READY | Prêt à récupérer |
| DELIVERED, INVOICED | Restitué |
| CANCELLED | Dossier clos |

- **RG-M14-17 — Contenu visible** : photos `Attachment` `kind ∈ {photo_checkin, photo_damage}` et photos des `InspectionItem` (URL signées 15 min, miniatures WebP 480 px) ; résultats d'inspection (OK / À surveiller / Urgent) **sans** les mesures internes si `settings.portal.showMeasurements = false` ; remarques `WorkNote` visibles client ; **jamais** : notes internes, prix d'achat, nom des mécaniciens (sauf `settings.portal.showTechnicianName`), pointages.
- **RG-M14-18 — Temps réel** : Server-Sent Events sur `/p/{token}/events` (canal Redis `ro:{id}`), repli polling 30 s ; connexion coupée après 10 min d'inactivité de l'onglet.

### 4.5 RDV, véhicule, relevé, avis

- **RG-M14-19 — Créneaux** : fournis par M03 (`appointments.availableSlots` avec `siteId`, `type`, durée standard du type) ; horizon 14 jours (`settings.portal.bookingHorizonDays`) ; délai minimum 2 h ; max 2 RDV futurs par véhicule via le portail ; jours fériés exclus (M15).
- **RG-M14-20 — Échéances affichées** : VT = `Vehicle.inspectionExpiryDate` ; révision = `nextServiceDueDate` et `nextServiceDueMileage` avec km estimé `estimatedMileage` ; badge « Bientôt » si ≤ 30 j, « Dépassée » si passée.
- **RG-M14-21 — Avis** : un seul avis par OR ; note 1-5, commentaire ≤ 1 000 caractères ; stocké `CustomerFeedback` (§14) ; `Reminder.outcome = REPLIED`.
- **RG-M14-22 — Accès OTP** : OTP 6 chiffres, valable 5 min, 5 essais, 3 envois/heure par numéro, via les canaux **du garage** (M11 ChannelConfig ; repli canal plateforme M01). Session portail = cookie `httpOnly`, `Secure`, `SameSite=Lax`, 30 jours, liée à `(organizationId, phone)` ; donne accès à tous les `Customer` de l'organisation ayant ce numéro en `phone`, `phone2` ou `whatsappPhone`, et aux entreprises dont un `CustomerContact` a ce numéro avec `portalAccess = true`. Déconnexion possible ; révocation de toutes les sessions par le personnel.
- **RG-M14-23 — Consentement** : la page `/p/compte/preferences` permet au client de gérer `remindersConsent`, `marketingConsent` et le canal préféré ; un désabonnement crée un `OptOut` (M11) et est journalisé.

### 4.6 Performance

- **RG-M14-24 — Budget** : HTML rendu côté serveur (RSC), JS client ≤ 70 Ko gzip pour les pages devis/facture/suivi (pas de bibliothèque de graphique, pas de shadcn lourd : composants légers dédiés `apps/web/app/p/_components`), police système, images lazy-load ; LCP < 2,5 s sur profil « Slow 3G » de Lighthouse ; fonctionne sans JavaScript pour la consultation (devis et facture lisibles, boutons d'action désactivés avec message).

## 5. Machine à états

`PortalToken` : `ACTIVE → EXPIRED` (date) | `REVOKED` (manuel ou automatique RG-M14-04). Effets de bord sur les cibles : `Quote` `SENT → VIEWED` (1re ouverture) `→ ACCEPTED | PARTIALLY_ACCEPTED | DECLINED` (décision portail, transitions définies en M05) ; `Appointment` `BOOKED → CONFIRMED | CANCELLED` ; création `Appointment` `BOOKED`.

## 6. Données

`PortalToken` (§14), `PortalSession` (§14), `PortalAccess` (§14), `CustomerFeedback` (§14), `Quote`, `QuoteLine`, `Invoice`, `InvoiceLine`, `PaymentLink`, `Payment`, `RepairOrder`, `Inspection`, `InspectionItem`, `Attachment`, `Appointment`, `Vehicle`, `Customer`, `CustomerContact` (+ `portalAccess`), `OptOut`, `Organization`/`Site` (identité).
Paramètres `Organization.settings.portal` : `enabled`, `domain`, `primaryColor`, `requireSignature`, `allowPartialPayment`, `minPartialAmount`, `showMeasurements`, `showTechnicianName`, `bookingEnabled`, `bookingHorizonDays`, `cancelCutoffHours`, `googleReviewUrl`, `otpLoginEnabled`.

## 7. Écrans et interface

Toutes les pages sous `apps/web/app/p/` : en-tête compact (logo garage, nom, bouton appel + WhatsApp), pied (adresse, horaires, « Propulsé par AtelierOS »), largeur max 560 px centrée, cibles ≥ 48 px, texte ≥ 16 px.

| Route | Contenu | Actions |
|---|---|---|
| `/p/[token]` | Aiguillage selon `scope` → rendu de la page cible | — |
| — devis | Véhicule, n° et validité, groupes de lignes avec photos, total dynamique collant en bas, explication dépliable | Je veux / Je ne veux pas par ligne, Valider + signature, Refuser, Poser une question (ouvre WhatsApp pré-rempli) |
| — facture | Facture complète, QR FNE, statut (Payée / Solde dû) | Payer, Télécharger PDF |
| — suivi OR | Frise de statuts, date promise, photos (carrousel), inspection en feux tricolores, remarques, devis en attente, facture | Voir le devis, Payer, Appeler |
| — RDV | Date, heure, site (lien Maps), véhicule, motif | Confirmer, Déplacer, Annuler |
| — prise de RDV | Motif, véhicule, calendrier 14 j + créneaux | Réserver |
| — véhicule | Échéances (cartes VT / Révision / Assurance), historique des passages | Prendre RDV, PDF facture |
| — relevé | Tableau factures/paiements, solde | PDF, Payer le solde |
| — avis | 5 étoiles, commentaire | Envoyer, Avis Google |
| `/p/connexion` | Téléphone → OTP | Recevoir le code |
| `/p/compte` | Onglets Véhicules · Devis · Factures · RDV · Relevé · Préférences | |
| `/p/compte/flotte` | Tableau flotte (entreprise) | Filtrer, export CSV, approuver devis |
| `/l/[code]` | Redirection 302 | — |

États : chargement (squelette léger), lien expiré, lien révoqué, ressource annulée, portail désactivé (« Le garage n'a pas activé cette page »), erreur réseau (bouton Réessayer, contenu déjà affiché conservé).

**Côté back-office** : sur chaque devis/facture/OR/RDV, bloc « Lien client » : copier, envoyer (WhatsApp/SMS/email via M11), date de dernière ouverture, nombre d'ouvertures, révoquer, régénérer. Paramètres dans `/parametres/portail` (M15). Avis dans `/clients/avis` (liste, filtres note, moyenne 30 j).

## 8. API

Procédures **publiques** (routeur tRPC `portal`, contexte sans session, authentifié par jeton ou session portail ; aucune ne prend d'`organizationId` en entrée) :

| Procédure | Entrée | Sortie |
|---|---|---|
| `portal.resolve` | `{ token }` | `{ scope, organization: {name, logoUrl, phone, whatsapp}, data }` (DTO filtré selon RG-M14-17) |
| `portal.quote.decide` | `{ token, acceptedLineIds[], signaturePng?, signerName, csrf }` | `{ status, acceptedTotal }` |
| `portal.quote.decline` | `{ token, reason, comment?, csrf }` | `{ status }` |
| `portal.invoice.createPaymentLink` | `{ token, method, amount? }` | `{ url }` |
| `portal.invoice.paymentStatus` | `{ token }` | `{ balance, lastPayment? }` |
| `portal.appointment.slots` | `{ token, date?, type? }` | `{ slots: [{startsAt, endsAt}] }` |
| `portal.appointment.book` | `{ token, vehicleId?, type, startsAt, notes? }` | `{ appointmentId, manageToken }` |
| `portal.appointment.confirm/reschedule/cancel` | `{ token, startsAt?, reason? }` | `{ status }` |
| `portal.feedback.submit` | `{ token, rating, comment? }` | `{ googleReviewUrl? }` |
| `portal.statement.pdf` | `{ token \| session, months }` | `{ url }` |
| `portal.auth.requestOtp` | `{ orgSlug, phone }` | `{ ok: true }` (toujours) |
| `portal.auth.verifyOtp` | `{ orgSlug, phone, code }` | cookie de session |
| `portal.account.overview` / `fleet` / `preferences.update` / `logout` | session | données / `{ ok }` |
| `portal.requestNewLink` | `{ token }` | `{ ok: true }` |

Procédures **back-office** : `portalLinks.create({ scope, targetId, expiresAt? }) → { url, shortUrl }`, `portalLinks.list({ targetId })`, `portalLinks.revoke({ id, reason })`, `portalLinks.send({ id, channel })`, `feedback.list({ rating?, cursor })`. Les variables `{{lien.devis}}`, `{{lien.facture}}`, `{{lien.paiement}}`, `{{lien.rdv}}` (02 §4) appellent `portalLinks.create` au rendu du message (jeton réutilisé s'il en existe un actif pour la même cible et le même scope).
REST (M13) : non exposé ; un intégrateur obtient un lien via `POST /api/v1/portal-links` (scope `invoices:read` ou `quotes:read`).

## 9. Automatisations et événements

- Émis : `quote.viewed`, `quote.accepted`, `quote.declined` (`payload.channel = "portal"`), `appointment.created` (`source = PORTAL`), `appointment.updated/cancelled`, `portal.feedback_received`, `portal.opened` (consommé par M10 pour l'outcome `REPLIED` et M12).
- Consommés : `repair_order.status_changed` (push SSE), `payment.received` (page facture), `quote.*` nouvelle version (révocation), `invoice.voided` (révocation).
- Tâches : `portal.tokens_expire` (quotidienne 03:30, passe `EXPIRED`, purge `PortalAccess` > 12 mois), relance `SATISFACTION` planifiée par M10 à `deliveredAt + 24 h`.
- Notifications internes : devis accepté/refusé (conseiller de l'OR), avis ≤ 3 (OWNER), paiement non confirmé après 2 min (CASHIER).

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Créer / envoyer / révoquer un lien devis | `quote:send` | OWNER, MANAGER, ADVISOR |
| Créer / envoyer un lien facture ou relevé | `invoice:read` + `message:send` | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |
| Lien de suivi OR / RDV / véhicule | `repair_order:read` / `appointment:create` + `message:send` | OWNER, MANAGER, ADVISOR |
| Paramètres du portail | `settings:update` | OWNER |
| Lire les avis | `customer:read` | Tous sauf MECHANIC |
| Donner l'accès portail à un contact entreprise | `customer:update` | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |

Client : uniquement ce que permet son jeton ou sa session portail (RG-M14-02, RG-M14-22).

## 11. Cas limites et erreurs

- Devis modifié par le conseiller pendant que le client le consulte → à la soumission : « Ce devis vient d'être mis à jour. Merci de vérifier les nouvelles lignes. » et rechargement (contrôle `Quote.updatedAt` envoyé avec la décision).
- Devis déjà décidé par téléphone (`decisionChannel = phone`) → page en lecture avec « Décision enregistrée le 18/10/2026 ».
- Client qui paie deux fois via deux liens → second paiement enregistré en `unallocated` (trop-perçu), notification caissier (M08).
- Fournisseur de paiement indisponible → « Le paiement en ligne est momentanément indisponible » + numéros marchands.
- Numéro partagé par deux clients (couple) → après OTP, sélecteur « Quel compte ? ».
- Contact entreprise retiré (`portalAccess = false`) → sessions portail de ce numéro pour cette entreprise invalidées immédiatement.
- Lien transféré à un tiers → possible par nature (jeton porteur) : la page ne montre que la ressource ciblée, téléphone masqué, pas d'adresse client ; les actions de devis exigent la signature nominative.
- Ancien navigateur (Android 6) → pas de SSE : polling ; pas de canvas → acceptation par case à cocher + nom saisi (signature textuelle consignée).
- Portail désactivé pour l'organisation → les variables `{{lien.*}}` sont rendues vides et M11 bloque l'envoi des modèles qui en dépendent avec une erreur explicite.

## 12. Tests

- **Unitaires `core/portal`** : génération/hachage de jeton, expiration par scope (RG-M14-03), mapping statut OR → étape client, total accepté avec lignes liées, filtrage du DTO (aucun champ interne : test par instantané des clés autorisées).
- **Intégration** : jeton de l'organisation A ne lit rien de B ; jeton QUOTE ne peut pas lire la facture ; double soumission de décision ; rate-limit et blocage IP ; OTP (expiration, 5 essais, réponse identique pour numéro inconnu) ; création de `PaymentLink` réutilisée ; webhook paiement → statut page.
- **E2E Playwright (viewport 390 px, réseau « Slow 3G »)** : ouvrir un lien devis → décocher une ligne → signer → la fiche devis back-office passe à « Partiellement accepté » ; ouvrir une facture → Payer Wave (adaptateur `console` simulant le webhook) → « Payé ✓ » ; prise de RDV depuis lien de relance VT.
- **Performance** : Lighthouse CI sur les pages devis/facture/suivi (LCP < 2,5 s, JS ≤ 70 Ko).

## 13. Définition de « terminé »

- [ ] Toutes les pages du tableau §7 avec états vides/erreurs/expirés.
- [ ] Jetons hachés, scopés, expirables, révocables ; lien court SMS.
- [ ] Devis ligne par ligne + signature + PDF signé ; facture avec QR FNE et paiement mobile money confirmé par webhook.
- [ ] Suivi OR temps réel (SSE + repli), RDV (prise, confirmation, report, annulation), historique véhicule, relevé, avis.
- [ ] Accès OTP et vue flotte.
- [ ] Budget de performance vérifié en CI ; tests d'isolation verts.

## 14. Évolutions du modèle de données

```prisma
model PortalToken {
  id             String   @id @default(cuid())
  organizationId String
  tokenHash      String   @unique              // sha256 du jeton clair
  shortCode      String?  @unique              // alias SMS /l/{code}
  scope          PortalScope
  targetId       String                        // id de la ressource ciblée
  customerId     String
  status         PortalTokenStatus @default(ACTIVE)
  expiresAt      DateTime
  createdById    String?                       // null = automatique (relance)
  reminderId     String?                       // relance ayant généré le lien
  firstOpenedAt  DateTime?
  lastOpenedAt   DateTime?
  openCount      Int      @default(0)
  revokedAt      DateTime?
  revokeReason   String?
  createdAt      DateTime @default(now())
  @@index([organizationId, scope, targetId])
}
enum PortalScope { QUOTE INVOICE REPAIR_ORDER APPOINTMENT BOOKING VEHICLE STATEMENT SURVEY }
enum PortalTokenStatus { ACTIVE EXPIRED REVOKED }

model PortalAccess {                            // journal des ouvertures et actions
  id             String   @id @default(cuid())
  organizationId String
  portalTokenId  String?
  portalSessionId String?
  action         String                         // open | quote_decide | pay_click | book | cancel | feedback
  ipPrefix       String?                        // IP tronquée /24
  userAgent      String?
  createdAt      DateTime @default(now())
}

model PortalSession {                           // accès par OTP téléphone
  id             String   @id @default(cuid())
  organizationId String
  phone          String                         // E.164
  tokenHash      String   @unique
  expiresAt      DateTime
  revokedAt      DateTime?
  lastSeenAt     DateTime?
  createdAt      DateTime @default(now())
}

model CustomerFeedback {
  id             String   @id @default(cuid())
  organizationId String
  siteId         String
  customerId     String
  repairOrderId  String   @unique
  rating         Int                            // 1-5
  comment        String?
  createdAt      DateTime @default(now())
}

// Ajout à CustomerContact
//   portalAccess  Boolean @default(false)       // accès vue flotte par OTP

// Organization.slug (unique) est défini dans M15 §14 ; utilisé par /p/connexion?g={slug}
```
Note : `Quote.publicToken` et `Invoice.publicToken` (02) sont conservés et contiennent le `tokenHash` du `PortalToken` actif principal, pour compatibilité.
