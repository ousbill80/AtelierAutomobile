# M05 — Devis et approbation client

> Priorité : **P0** · Dépend de : M01, M02, M04 · Interagit avec : M07 (prix et disponibilité des pièces), M08 (conversion en facture, acompte), M10 (relance des devis non signés), M11 (envoi WhatsApp/SMS/email), M14 (page d'approbation), M16 (part assurance/franchise), M17 (rédaction, prix suggérés) · Rôles concernés : `ADVISOR`, `MANAGER`, `OWNER`, `CUSTOMER`

## 1. Objectif

Faire accepter plus de travaux, plus vite, sans contestation. Aujourd'hui le devis est rédigé à la main ou sous Excel, envoyé en photo sur WhatsApp, accepté « oralement », puis contesté à la facture ; personne ne relance les devis restés sans réponse. M05 permet de produire un devis propre en 2 minutes (depuis un OR, depuis l'inspection multipoints, ou libre), avec catalogue MO/pièces et remises encadrées, de l'envoyer par lien WhatsApp/SMS/email, de faire **approuver ligne par ligne** par le client depuis son téléphone avec signature, de tracer tout accord en personne ou par téléphone, de relancer automatiquement, et de convertir le devis en OR ou en facture. Cible : taux d'acceptation ≥ 70 % (00 §8).

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| `ADVISOR` | Crée et envoie les devis, enregistre les accords au téléphone ou au comptoir, répond aux questions | 5 à 30 devis/jour |
| `MANAGER` | Valide les remises au-delà du plafond, gère le catalogue MO, révise les devis complexes (carrosserie) | Quotidienne |
| `OWNER` | Suit le taux d'acceptation, les devis en attente à fort montant, accorde les remises exceptionnelles | Hebdomadaire |
| `CUSTOMER` | Ouvre le lien, voit photos et explications, accepte/refuse ligne par ligne, signe, pose une question | Par devis |
| Gestionnaire de flotte / assureur (destinataire) | Reçoit le devis d'une entreprise ou d'un sinistre, l'approuve | Ponctuelle |

## 3. User stories

**US-M05-01 — En tant que réceptionnaire, je veux générer un devis depuis l'inspection multipoints en un clic.**
- Étant donné l'OR-YOP-2026-00042 avec inspection terminée (plaquettes AV : URGENT ; amortisseurs AR : WATCH ; balais d'essuie-glace : WATCH), quand je clique « Créer le devis », alors un devis `DRAFT` `DEV-YOP-2026-00017` v1 est créé, lié à l'OR et au véhicule, avec trois groupes de lignes :
  - *Urgent — Plaquettes avant* : MO « Remplacement plaquettes AV » 1 h × 15 000 = 15 000 FCFA ; « Jeu de plaquettes AV Toyota Corolla » 1 × 28 000 FCFA — non optionnel, `priority = URGENT`.
  - *À surveiller — Amortisseurs arrière* : MO 2 h × 15 000 = 30 000 ; 2 amortisseurs × 45 000 = 90 000 — `isOptional = true`, `priority = WATCH`.
  - *À surveiller — Balais d'essuie-glace* : 1 jeu × 8 000 — optionnel.
- Étant donné les photos des items d'inspection, alors elles sont attachées aux groupes correspondants et visibles par le client.
- Étant donné les lignes déjà approuvées à la réception (vidange), alors elles ne sont **pas** reprises dans le devis complémentaire (affichées en lecture seule « Déjà accepté : Vidange 31 000 FCFA HT »).

**US-M05-02 — En tant que réceptionnaire, je veux créer un devis libre pour un client qui demande un prix au comptoir ou par WhatsApp, sans OR.**
- Étant donné Mme Bamba qui demande « combien pour la distribution de mon Tucson ? », quand je crée un devis libre (client, véhicule facultatif), que je tape « distrib » et choisis le forfait « Kit de distribution + pompe à eau » du catalogue, alors les lignes MO et pièces associées (kit) sont ajoutées avec les prix catalogue et la disponibilité en stock (« En stock : 1 » / « À commander : délai 3 j »).
- Étant donné un client non enregistré (prospect), alors je peux saisir seulement nom + téléphone ; le client est créé avec `source = "devis"`.

**US-M05-03 — En tant que réceptionnaire, je veux appliquer une remise dans la limite de mon rôle.**
- Étant donné mon plafond `ADVISOR` de 10 % par ligne et 5 % sur le total, quand je mets 15 % sur la MO, alors le champ passe en orange « Au-delà de votre plafond (10 %) — validation du chef d'atelier requise » et le devis ne peut pas être envoyé tant qu'un utilisateur ayant `quote:discount_override` (ou un plafond suffisant) ne l'a pas validé (`discountApprovedById`).
- Étant donné la demande de validation, alors le chef d'atelier reçoit une notification avec boutons « Approuver » / « Refuser » (et « Approuver à 10 % »).
- Étant donné une remise faisant passer une pièce sous `Product.minSalePrice`, alors c'est bloquant sauf `invoice:price_below_min`.

**US-M05-04 — En tant que réceptionnaire, je veux envoyer le devis par WhatsApp avec un lien, et savoir quand le client l'a ouvert.**
- Étant donné un devis prêt, quand je clique « Envoyer », alors je choisis le canal (WhatsApp par défaut, SMS, email, ou « Copier le lien ») et le destinataire (client, ou contact flotte `receivesInvoices`/`receivesReminders`, ou assureur), le message est pré-rédigé : « Bonjour M. Kouassi, voici le devis DEV-YOP-2026-00017 pour votre Toyota Corolla (2547 GH 01) : 201 780 FCFA TTC (dont 50 740 FCFA urgents). Consultez-le et validez les travaux ici : {{lien.devis}} — Garage Excellence Auto ». Le PDF est joint en email ; sur WhatsApp, le lien suffit (PDF disponible sur la page).
- Étant donné l'envoi, alors le statut passe `SENT`, `sentAt` est horodaté, `quote.sent` est émis (M04 → `AWAITING_APPROVAL`, M10 planifie la relance).
- Étant donné l'ouverture du lien par le client, alors le statut passe `VIEWED`, `viewedAt` est horodaté et le réceptionnaire voit « Vu par le client il y a 12 min » (pas de notification au-delà de la première ouverture).
- Étant donné le mode WhatsApp `wa_link` (pas d'API), alors « Ouvrir dans WhatsApp » ouvre la conversation avec le message pré-rempli, et le devis passe `SENT` au clic (`sentVia = wa_link`).

**US-M05-05 — En tant que client, je veux accepter ou refuser chaque ligne depuis mon téléphone et signer.**
- Étant donné le lien `/p/[token]/devis`, alors je vois : logo et coordonnées du garage, mon véhicule, le résumé « 3 travaux recommandés », chaque groupe avec badge (Urgent rouge / À surveiller orange), explication simple, photos (zoom), prix TTC, et un interrupteur Accepter/Refuser (les lignes urgentes sont présélectionnées « Accepter », les optionnelles « non choisi »).
- Étant donné mes choix (urgent accepté, amortisseurs refusés, balais acceptés), alors le total se met à jour en direct : « Total accepté : 60 180 FCFA TTC ».
- Étant donné « Valider mon choix », alors je saisis mon nom, je signe au doigt (ou coche « J'accepte » si `settings.quotes.requireSignature = false`), et pour les refus je peux indiquer un motif (« Trop cher », « Je le ferai plus tard », « Je fais faire ailleurs », « Autre »).
- Étant donné la validation, alors `QuoteLine.accepted` est rempli pour chaque ligne, le devis passe `PARTIALLY_ACCEPTED`, `decidedAt`, `decisionChannel = portal`, `signatureUrl`, `signerName`, IP et user-agent sont enregistrés, et je vois « Merci, l'atelier commence les travaux acceptés. » ; le réceptionnaire est notifié.
- Étant donné un devis expiré ou déjà décidé, alors la page est en lecture seule avec « Ce devis a été validé le 20/10/2026 à 10:42 » ou « Ce devis a expiré. Contactez-nous pour l'actualiser. »

**US-M05-06 — En tant que client, je veux poser une question sur le devis avant de décider.**
- Étant donné le bouton « Poser une question » sur la page, alors un message libre est envoyé dans la boîte de réception (M11, conversation du client, avec référence au devis) et le statut du devis n'est pas modifié ; le réceptionnaire répond par WhatsApp.
- Étant donné le bouton « Être rappelé », alors une tâche « Rappeler M. Kouassi au sujet du devis » est créée pour le conseiller.

**US-M05-07 — En tant que réceptionnaire, je veux enregistrer un accord donné au téléphone ou en personne, avec une preuve.**
- Étant donné un client qui appelle et dit « faites seulement les plaquettes », quand je clique « Enregistrer la décision » → « Par téléphone », alors je coche les lignes acceptées, saisis l'interlocuteur (« M. Kouassi lui-même ») et l'heure, et le système envoie automatiquement au client un **message de confirmation écrit** : « Suite à notre appel de 10:15, vous avez accepté : Plaquettes avant (50 740 FCFA TTC). Refusé : Amortisseurs arrière, Balais. Si ce n'est pas correct, répondez à ce message. » (`decisionChannel = phone`, `recordedById`).
- Étant donné un accord au comptoir, alors « En personne » propose la signature sur la tablette (même écran que le portail en mode kiosque).
- Étant donné un accord reçu par message WhatsApp libre (« ok pour les plaquettes »), alors « Par WhatsApp » permet de lier le message entrant comme preuve (`decisionMessageId`).

**US-M05-08 — En tant que réceptionnaire, je veux modifier un devis déjà envoyé sans perdre la trace de la version initiale.**
- Étant donné le devis v1 `SENT`, quand je clique « Modifier », alors une **version 2** est créée (même `number`, `version = 2`, lignes copiées), la v1 passe en lecture seule avec la mention « Remplacée par la v2 » et son lien public affiche « Ce devis a été mis à jour » avec redirection vers la v2 ; il faut renvoyer la v2.
- Étant donné un devis `DRAFT` jamais envoyé, alors la modification se fait en place (pas de nouvelle version).
- Étant donné l'onglet « Versions », alors je vois les écarts entre versions (lignes ajoutées/retirées/prix modifiés, total).

**US-M05-09 — En tant que gérant, je veux que les devis sans réponse soient relancés automatiquement.**
- Étant donné un devis `SENT`/`VIEWED` sans décision, alors M10 (règle `QUOTE_FOLLOWUP`) envoie par défaut : J+2 « Avez-vous pu consulter le devis ? Vos plaquettes avant sont à remplacer rapidement pour votre sécurité. {{lien.devis}} », J+5 un second rappel, puis tâche « Appeler le client » à J+7 ; la séquence s'arrête à la décision, à l'expiration, ou à l'annulation.
- Étant donné un devis lié à un OR (véhicule immobilisé à l'atelier), alors le premier rappel part à **H+4** (heures ouvrées) au lieu de J+2 (paramétrable : `settings.quotes.followupWhenVehicleOnSite`).

**US-M05-10 — En tant que gérant, je veux que les devis expirent et puissent être réactivés.**
- Étant donné `validUntil = 03/11/2026` (15 jours par défaut), quand le job passe le 04/11, alors un devis non décidé passe `EXPIRED`, `quote.expired` est émis, les lignes non acceptées liées à des items d'inspection alimentent `VehicleRecommendation` (M04) pour une relance future.
- Étant donné « Réactiver » sur un devis expiré, alors une nouvelle version est créée avec les prix catalogue actuels et une nouvelle validité (écarts de prix mis en évidence).

**US-M05-11 — En tant que réceptionnaire, je veux convertir un devis accepté en OR ou en facture.**
- Étant donné un devis libre accepté (sans OR), quand je clique « Créer l'OR », alors un OR `DRAFT` est créé avec les lignes acceptées (`approval = APPROVED`, `approvalSource = QUOTE`, `quoteLineId`), et je peux planifier un RDV (M03, durée = somme des temps barème).
- Étant donné un devis lié à un OR, alors la conversion est automatique à l'acceptation (pas d'action requise) : les lignes acceptées sont ajoutées/approuvées dans l'OR.
- Étant donné un devis de vente comptoir (pièces seules, sans travaux), alors « Facturer » crée une facture brouillon M08 (`Invoice.quoteId`) avec les lignes acceptées.
- Étant donné la conversion complète, alors le devis passe `CONVERTED` (statut terminal, conserve `accepted` sur chaque ligne).

**US-M05-12 — En tant que réceptionnaire, je veux demander un acompte à l'acceptation pour les gros travaux.**
- Étant donné un devis accepté de 850 000 FCFA (moteur) et la règle « acompte 50 % au-delà de 300 000 FCFA » (`settings.quotes.depositRule`), alors la page client affiche après signature « Acompte demandé : 425 000 FCFA » avec bouton de paiement mobile money (M08 crée une facture d'acompte `DEPOSIT` et un lien de paiement) ; le réceptionnaire voit « Acompte en attente » sur l'OR, qui reste `APPROVED` sans blocage automatique (le chef d'atelier décide de commencer ou non).

**US-M05-13 — En tant que réceptionnaire, je veux produire un devis de sinistre avec la part de l'assurance et la franchise du client.**
- Étant donné un OR lié à un `InsuranceClaim` (franchise 100 000 FCFA, assureur « NSIA Assurances »), quand je marque les lignes de carrosserie `payer = INSURANCE`, alors le devis calcule : total TTC 1 180 000 FCFA, `insuranceShare = 1 080 000`, `customerShare = 100 000` (franchise) + lignes `CUSTOMER` hors sinistre éventuelles.
- Étant donné l'envoi, alors deux destinataires sont possibles : l'assureur/expert (PDF complet « Devis d'expertise ») et le client (page d'approbation de sa part uniquement + information sur la part assurance).
- Étant donné l'accord de l'expert avec un montant approuvé inférieur (980 000), alors « Enregistrer l'accord de l'assurance » saisit `approvedAmount` (M16) et recalcule : l'écart (100 000) est soit abandonné (remise), soit reporté sur le client (avec son accord tracé).

**US-M05-14 — En tant que gérant, je veux suivre le taux d'acceptation des devis.**
- Étant donné `/devis` onglet « Statistiques » (et M12), alors je vois sur la période : nombre de devis envoyés, taux d'acceptation en nombre (devis au moins partiellement acceptés / devis décidés + expirés) et en valeur (montant accepté / montant proposé), délai médian de décision, taux par conseiller, par type de travaux, par priorité (urgent/à surveiller), motifs de refus, montant récupéré grâce aux relances de devis.

## 4. Règles métier

**RG-M05-01 — Numérotation et versions.** `number = "DEV-" + Site.code + "-" + année + "-" + séquence 5 chiffres` (ex. `DEV-YOP-2026-00017`), attribué à la création (`DocumentSequence` docType `DEV`). Une nouvelle version garde le même `number`, `version + 1`. Une seule version « courante » par numéro (`supersededAt` nul) ; les autres sont en lecture seule. Unicité `(organizationId, number, version)` (02).

**RG-M05-02 — Origines.** `origin` : `REPAIR_ORDER` (complément d'un OR), `INSPECTION` (depuis une inspection, implique un OR), `STANDALONE` (libre/comptoir), `APPOINTMENT` (préparé avant un RDV), `INSURANCE` (sinistre). Un devis `STANDALONE` peut ne pas avoir de véhicule (vente de pièces) mais doit avoir un client.

**RG-M05-03 — Lignes et calculs.** Mêmes types (`LineType`) et même calcul que l'OR (`core/money/lines.ts`, RG-M04-05) : arrondi par ligne, TVA par ligne, `vatEnabled` de l'organisation. Totaux du devis :
```
subtotal      = Σ gross des lignes            (HT avant remise)
discountTotal = Σ remises de ligne + remise globale
vatTotal      = Σ vat des lignes (après remises)
total         = subtotal − discountTotal + vatTotal          (TTC)
acceptedTotal = même calcul restreint aux lignes accepted = true   (affiché, non stocké : calculé)
insuranceShare = Σ total des lignes payer = INSURANCE − franchise imputée (RG-M05-13)
customerShare  = total − insuranceShare
```
Remise globale (`globalDiscountRate` en % ou `globalDiscountAmount` en FCFA) : répartie au prorata du HT des lignes (méthode du plus grand reste pour tomber juste à l'unité), puis TVA recalculée par ligne. Exemple : lignes HT 100 000 et 50 000, remise globale 9 000 → 6 000 et 3 000.
Exemple complet (US-M05-01) : plaquettes 15 000 + 28 000 = 43 000 HT, TVA 7 740, TTC 50 740 ; amortisseurs 30 000 + 90 000 = 120 000 HT, TVA 21 600, TTC 141 600 ; balais 8 000 HT, TVA 1 440, TTC 9 440. Total TTC = 201 780 FCFA. Accepté (plaquettes + balais) = 60 180 FCFA TTC.

**RG-M05-04 — Groupes.** Les lignes peuvent être regroupées (`groupKey`, `groupLabel`) : MO + pièces d'un même travail. L'acceptation par le client se fait **par groupe** (toutes les lignes du groupe prennent la même valeur) ; une ligne sans groupe est son propre groupe. Le personnel peut toutefois saisir une décision ligne par ligne (`quote.recordDecision`).

**RG-M05-05 — Catalogue MO** (`LaborOperation`). Prix d'une opération = `fixedPrice` si défini (forfait, `quantity = 1`) sinon `standardHours × taux(rateType)` (taux dans `settings.laborRates`, cf. M04 RG-M04-06). Les opérations peuvent porter un **kit** de pièces par défaut (`defaultParts` : catégories ou produits, quantités) et une compatibilité (marque/modèle) pour les durées spécifiques (ex. « Kit distribution » : 3 h sur Corolla, 4,5 h sur Hilux). Semences (extrait) : Vidange moteur + filtre (0,5 h ; forfait possible 25 000 FCFA TTC pièces incluses pour les citadines), Remplacement plaquettes AV (1 h), Disques + plaquettes AV (1,5 h), Kit distribution (3 h), Diagnostic électronique (forfait 20 000), Recharge climatisation (forfait 35 000), Géométrie/parallélisme (forfait 15 000), Remplacement batterie (0,25 h), Pré-visite technique (forfait 10 000), Remplacement amortisseurs AV/AR (2 h la paire).

**RG-M05-06 — Prix des pièces.** `Product.salePrice` (ou tarif du client). Disponibilité affichée depuis M07 : `onHand − reserved` sur le site du devis ; pièce hors stock → délai indicatif = `Supplier` par défaut (`settings.defaultLeadTimeDays`, 3 j). Pièce hors catalogue : description libre + prix saisi + coût d'achat estimé (pour la marge). Marge prévisionnelle du devis visible avec `product:view_cost` uniquement.

**RG-M05-07 — Plafonds de remise par rôle** (`settings.quotes.discountCaps`, modifiable par `OWNER`) :
| Rôle | Remise max par ligne | Remise globale max |
|---|---|---|
| `ADVISOR` | 10 % | 5 % |
| `MANAGER` | 20 % | 15 % |
| `CASHIER` | 0 % | 0 % |
| `OWNER` | 100 % | 100 % |
`quote:discount_override` permet de dépasser son plafond (jusqu'à celui de `OWNER`). Au-delà du plafond sans cette permission : le devis est marqué `discountApprovalStatus = PENDING`, l'envoi est bloqué, une `Notification` part aux détenteurs de `quote:discount_override`. Toute remise > 0 exige un motif si elle dépasse 5 % (« Client fidèle », « Flotte », « Geste commercial », « Alignement concurrence », autre). Audit `quote.discount_approved`.

**RG-M05-08 — Validité.** `validUntil = date de création + settings.quotes.validityDays` (défaut 15 jours ; 30 pour `COMPANY` ; 30 pour sinistre). Modifiable avant envoi. Prix garantis jusqu'à `validUntil` inclus. Job `quotes.expire` (00:30 heure de l'organisation) : `SENT`/`VIEWED` avec `validUntil < aujourd'hui` → `EXPIRED`. Un devis `PARTIALLY_ACCEPTED`/`ACCEPTED` n'expire pas.

**RG-M05-09 — Lien public.** `publicToken` : 32 octets aléatoires base64url, unique, créé au premier envoi. Portée : ce devis (et ses versions suivantes par redirection) uniquement. Expire à `validUntil + 30 jours` pour la lecture ; décision impossible après `validUntil`. Révocable (« Régénérer le lien »). Accès sans compte. Lien court via le domaine du portail (`{APP_URL}/p/{token}`). Pas d'indexation (`noindex`). Limitation : 30 requêtes/min/jeton.

**RG-M05-10 — Signature et preuve.** Une décision portail enregistre : choix par ligne, nom saisi, image de signature (PNG, `Attachment` `kind = signature`), horodatage serveur, IP, user-agent, hash SHA-256 du contenu du devis (lignes + prix + total) au moment de la signature (`decisionHash`), stocké pour prouver que le devis signé n'a pas été modifié. Le PDF « Devis signé » est régénéré avec la mention « Accepté électroniquement par Kouassi Jean-Marc le 20/10/2026 à 10:42 (empreinte 3f9a…) ». Décision par téléphone : `recordedById` + interlocuteur + message de confirmation écrit envoyé automatiquement (US-M05-07) ; sans canal disponible, une note « Confirmation écrite impossible (client sans mobile) » est enregistrée.

**RG-M05-11 — Décision et statut résultant.**
- Toutes les lignes acceptées → `ACCEPTED`.
- Au moins une acceptée et au moins une refusée → `PARTIALLY_ACCEPTED`.
- Toutes refusées → `DECLINED` (`declineReason`).
- Les lignes non optionnelles ne peuvent pas rester « non décidées » au moment de la validation ; les lignes optionnelles non touchées sont considérées refusées.
- Une décision est **définitive** pour une version ; pour revenir dessus (le client change d'avis), le conseiller crée une nouvelle version ou enregistre une décision complémentaire sur les lignes refusées (`quote.recordDecision` avec `amendment = true`, uniquement refusé → accepté, tracé).

**RG-M05-12 — Effets de l'acceptation** (transaction + événements) :
- Devis lié à un OR : lignes acceptées copiées dans l'OR (`RepairOrderLine.quoteLineId`, `approval = APPROVED`, `approvalSource = QUOTE`, prix du devis) ou, si elles existaient déjà en `PENDING` dans l'OR, passées `APPROVED` ; lignes refusées → `DECLINED` dans l'OR ; items d'inspection refusés → `VehicleRecommendation` (M04).
- Devis sans OR : rien n'est créé automatiquement ; proposition « Créer l'OR » / « Planifier un RDV » / « Facturer ».
- Émission `quote.accepted` (statut `ACCEPTED` ou `PARTIALLY_ACCEPTED`, payload avec montants) ou `quote.declined`.
- Notification au conseiller (et au chef d'atelier si l'OR attendait).
- M10 : arrêt des relances `QUOTE_FOLLOWUP` (`stopOn: quote.accepted, quote.declined`).

**RG-M05-13 — Assurance et franchise.**
- Lignes `payer = INSURANCE` : prises en charge par l'assureur ; `payer = CUSTOMER` : client ; `WARRANTY`/`INTERNAL` : affichées à 0 pour le client (« pris en charge par le garage »).
- Franchise (`InsuranceClaim.deductible`) : imputée au client, déduite de la part assurance : `insuranceShare = max(0, Σ TTC lignes INSURANCE − deductible)`, `customerShare = total − insuranceShare`.
- Si l'assureur approuve un montant inférieur (`approvedAmount`), l'écart est présenté au conseiller avec deux options : remise commerciale (remise globale sur les lignes assurance, soumise aux plafonds RG-M05-07) ou report au client (nouvelle version à faire accepter par le client).
- Le client n'approuve que sa part ; l'accord de l'assureur est enregistré par le conseiller (`decisionChannel = insurer`, document joint).

**RG-M05-14 — Acompte.** `settings.quotes.depositRule = { thresholdTtc: 300000, rate: 50 }` (désactivé par défaut). Si total accepté ≥ seuil : montant d'acompte = `round(total accepté × rate / 100)` arrondi à la centaine supérieure ; M08 crée l'`Invoice` `DEPOSIT` et le lien de paiement à la demande. Pièces à commander spécialement (`isStocked = false`) : acompte suggéré au moins égal au coût d'achat de ces pièces, même sous le seuil.

**RG-M05-15 — Envoi.** Canaux selon M11 (préféré du client → WhatsApp → SMS → email ; le SMS contient uniquement un texte court + lien). Destinataires : client, contacts d'entreprise, assureur (email). Un devis ne peut être envoyé que s'il a ≥ 1 ligne, un total > 0 (ou uniquement des lignes garantie) et aucune remise en attente de validation. Le devis envoyé est figé : toute modification crée une version (RG-M05-01). L'envoi d'une nouvelle version annule les relances planifiées de la précédente et redémarre la séquence.

**RG-M05-16 — Taux d'acceptation** (calcul `core/quotes/stats.ts`, utilisé par M12) sur une période, par date d'envoi :
```
devis décidés     = statuts ACCEPTED, PARTIALLY_ACCEPTED, DECLINED, CONVERTED (dernière version de chaque numéro)
devis clos        = décidés + EXPIRED
tauxNombre        = (ACCEPTED + PARTIALLY_ACCEPTED + CONVERTED) / devis clos
tauxValeur        = Σ montant TTC accepté / Σ montant TTC proposé (devis clos)
délai de décision = médiane(decidedAt − sentAt)
```
Seule la dernière version de chaque numéro compte ; les devis jamais envoyés sont exclus. Exemple : 40 devis clos, 26 au moins partiellement acceptés → 65 % ; 4 850 000 proposés, 3 120 000 acceptés → 64 % en valeur.

**RG-M05-17 — Mode `REMINDERS_ONLY`.** Le module devis est masqué ; seule la relance de devis importés (M13 : `Quote` importé avec `status = SENT`) est possible si la règle `QUOTE_FOLLOWUP` est active, le lien pointant alors vers un PDF importé ou vers « Appelez le garage ».

## 5. Machine à états

```
DRAFT ──send──► SENT ──client ouvre──► VIEWED
  │               │                      │
  │               ├──── decide ──────────┤──► ACCEPTED ─────────┐
  │               │                      ├──► PARTIALLY_ACCEPTED ┼──convert──► CONVERTED
  │               │                      └──► DECLINED           │
  │               └── validUntil dépassée (SENT/VIEWED) ──► EXPIRED ──reactivate──► (nouvelle version DRAFT)
  └──delete (jamais envoyé)──► supprimé logiquement
  SENT/VIEWED ──edit──► nouvelle version DRAFT (l'ancienne : supersededAt, lecture seule)
```

| Transition | De → Vers | Déclencheur / qui | Gardes | Effets |
|---|---|---|---|---|
| `send` | DRAFT → SENT | `quote.send` (`quote:send`) | ≥ 1 ligne ; pas de remise en attente ; client joignable sur le canal (sinon « Copier le lien »/imprimer) | `publicToken`, `sentAt`, message M11, `quote.sent`, M04 → `AWAITING_APPROVAL`, M10 planifie la relance |
| `view` | SENT → VIEWED | ouverture du lien public (hors personnel connecté, hors robots d'aperçu de lien : user-agents WhatsApp/Facebook ignorés) | — | `viewedAt`, `quote.viewed` |
| `decide` | SENT/VIEWED → ACCEPTED/PARTIALLY_ACCEPTED/DECLINED | client (portail) ou personnel (`quote:record_decision`) | `validUntil ≥ aujourd'hui` (personnel : forçable avec motif) | RG-M05-10/12, `quote.accepted`/`quote.declined` |
| `decide` (direct) | DRAFT → ACCEPTED/… | personnel, accord en personne immédiat | — | idem, sans envoi |
| `expire` | SENT/VIEWED → EXPIRED | job `quotes.expire` | non décidé | `quote.expired`, recommandations, arrêt relances |
| `edit` | SENT/VIEWED/EXPIRED → nouvelle version DRAFT | `quote.createVersion` (`quote:update`) | non décidé, ou EXPIRED (« Réactiver ») | ancienne version `supersededAt`, lien redirigé, relances annulées |
| `convert` | ACCEPTED/PARTIALLY_ACCEPTED → CONVERTED | `quote.convertToRepairOrder` / `quote.convertToInvoice` (auto si lié à un OR) | lignes acceptées ≥ 1 | OR/facture créés ou mis à jour |
| `delete` | DRAFT (jamais envoyé) | `quote:delete` | — | `deletedAt`, audit |

`DECLINED`, `EXPIRED` (sans réactivation) et `CONVERTED` sont terminaux. Un devis envoyé ne se supprime jamais (traçabilité).

## 6. Données

Entités de `02` : `Quote`, `QuoteLine`, `LaborOperation`, `Product`, `StockLevel` (disponibilité), `Customer`, `CustomerContact`, `Vehicle`, `RepairOrder`, `RepairOrderLine`, `Inspection`, `InspectionItem`, `InsuranceClaim`, `Invoice` (conversion, acompte), `Attachment` (photos, signature, PDF), `Message`, `Reminder`, `DocumentSequence`, `AuditLog`, `AiInteraction`.

Statuts `QuoteStatus` utilisés tels que définis dans 02. `Quote.decisionChannel` prend les valeurs `portal | whatsapp | in_person | phone | insurer`.

Ajouts (§14) : `Quote.origin`, `inspectionId`, `insuranceClaimId`, `supersededAt`, `supersedesId`, `globalDiscountRate/Amount`, `discountReason`, `discountApprovalStatus`, `discountApprovedById`, `sentVia`, `sentTo`, `decisionHash`, `decisionIp`, `decisionUserAgent`, `decisionMessageId`, `recordedById`, `depositAmount`, `depositInvoiceId`, `acceptedTotal` (dénormalisé pour les statistiques), `convertedAt` ; `QuoteLine` : `organizationId`, `groupKey`, `groupLabel`, `customerExplanation`, `inspectionItemId`, `costPrice`, `isCustomerSupplied`, `declineReason`, `lineSubtotal/lineVat/lineTotal`, `photoAttachmentIds` ; `LaborOperation` : `defaultParts`, `vehicleOverrides`, `customerDescription`.

Paramètres `Organization.settings.quotes` : `validityDays` (15), `validityDaysCompany` (30), `requireSignature` (true), `discountCaps` (RG-M05-07), `depositRule` (null), `followupWhenVehicleOnSite` (`"H+4"`), `showLinePricesToCustomer` (true — sinon prix par groupe uniquement), `termsText` (conditions imprimées : « Devis valable 15 jours. Pièces commandées spécialement non reprises. »).

## 7. Écrans et interface

| Route | Contenu | Actions | Mobile |
|---|---|---|---|
| `/(app)/devis` | Onglets : **À traiter** (brouillons, remises à valider), **En attente** (SENT/VIEWED, tri par ancienneté, indicateur « vu / non vu », nombre de relances envoyées, jours avant expiration), **Décidés**, **Expirés**, **Statistiques**. Colonnes : n° (+ version), date, client, véhicule, origine, total TTC, accepté TTC, statut (badge), conseiller, dernière action | Filtres (statut, conseiller, période, montant ≥, origine, site), recherche, « Nouveau devis », actions groupées : renvoyer, relancer maintenant | Cartes avec montant et statut |
| `/(app)/devis/nouveau` et `/(app)/devis/[id]` (éditeur) | **En-tête** : client (picker + création rapide), véhicule, OR lié, origine, validité, destinataire. **Lignes** : barre de recherche unique catalogue (MO, pièces, kits) avec disponibilité stock et prix ; tableau éditable (groupe, type, description, qté, PU, remise %, TVA, total, payeur, optionnel, priorité) ; glisser pour réordonner/regrouper ; explication client par groupe (texte simple, bouton « Rédiger avec l'IA ») ; photos par groupe. **Pied** : remise globale + motif, totaux HT/remises/TVA/TTC, part assurance/client, marge prévisionnelle (si `product:view_cost`), acompte calculé. Bandeau d'état (brouillon, remise à valider, envoyé v2…) | Enregistrer, Aperçu client, PDF, Envoyer, Enregistrer la décision, Nouvelle version, Convertir, Dupliquer, Supprimer (brouillon) | Lignes en cartes empilées, ajout par recherche plein écran |
| `/(app)/devis/[id]` (consultation) | Mêmes informations en lecture, frise : créé → envoyé (canal) → vu → relances → décision (canal, signataire, signature, empreinte) → converti ; décisions par ligne (✓/✗ + motif) ; versions ; messages liés | Renvoyer, Relancer maintenant, Copier le lien, Régénérer le lien | |
| Modale « Enregistrer la décision » | Canal (Téléphone / En personne / WhatsApp / Assureur), cases par groupe/ligne, interlocuteur, preuve (message lié, document), signature tablette (en personne), « Envoyer la confirmation écrite » (coché) | Valider | Plein écran |
| Modale « Valider la remise » (chef d'atelier) | Devis, ligne(s), remise demandée vs plafond, motif, marge après remise | Approuver, Approuver à X %, Refuser | Depuis la notification |
| `/p/[token]/devis` (portail public) | En-tête garage, véhicule (photo si disponible), statut ; liste des groupes par priorité (Urgent → À surveiller → Autres) avec badge couleur + icône + texte, explication, photos (galerie plein écran), prix TTC du groupe, interrupteur Accepter/Refuser ; barre fixe en bas « Total accepté : 60 180 FCFA » + « Valider mon choix » ; étape signature (nom + pad) ; motif de refus ; boutons « Poser une question » / « Être rappelé » / « Télécharger le PDF » ; si acompte : bouton de paiement | Valider, Question, Rappel, PDF, Payer l'acompte | Mobile d'abord, < 200 Ko hors photos, fonctionne sur Android d'entrée de gamme, police ≥ 16 px |
| `/(app)/parametres/devis` | Validité, signature obligatoire, plafonds de remise par rôle, acompte, délais de relance (renvoi vers M10 pour les paliers), conditions imprimées, affichage des prix par ligne | Enregistrer | |
| `/(app)/parametres/catalogue-mo` | Opérations : code, nom, catégorie, temps barème, type de taux, forfait, kit de pièces, durées par modèle, description client ; import CSV | Créer, modifier, archiver, importer | |

**PDF devis** (`packages/pdf`) : en-tête garage (logo, adresse, téléphone, RCCM, NCC, régime), n° + version, date, validité, client (NCC si entreprise), véhicule (plaque, modèle, km), lignes groupées avec priorité, sous-totaux par groupe, remises, TVA, TTC, part assurance/franchise, conditions, zone signature (ou bloc « Accepté électroniquement … empreinte »), QR code vers le lien public. Variante « Devis d'expertise » (assureur) : détail complet MO (temps × taux) et références pièces.

**États** : aucun devis → « Aucun devis en attente. Les inspections terminées apparaîtront ici. » ; erreur d'envoi (WhatsApp échoué) → badge rouge + « Renvoyer par SMS » ; lien ouvert hors validité → page explicative avec numéro du garage.

## 8. API

| Procédure | Entrée | Sortie |
|---|---|---|
| `quote.list` | `{ siteId?, statuses?, advisorId?, origin?, from?, to?, minTotal?, q?, cursor }` | page (dernière version de chaque numéro) |
| `quote.get` | `{ id }` | devis + lignes + groupes + versions + frise + messages + transitions autorisées |
| `quote.create` | `{ siteId, customerId \| newCustomer: { name, phone }, vehicleId?, repairOrderId?, origin, validUntil?, lines?: QuoteLineInput[] }` | devis `DRAFT` |
| `quote.createFromInspection` | `{ inspectionId, includeWatch=true }` | devis `DRAFT` + items marqués `addedToQuote` |
| `quote.createFromRepairOrderPending` | `{ repairOrderId }` | devis contenant les lignes OR `PENDING` |
| `quote.update` | `{ id, patch: { validUntil?, notes?, globalDiscountRate?, globalDiscountAmount?, discountReason? } }` | devis (DRAFT uniquement) |
| `quoteLine.add` / `.update` / `.remove` / `.reorder` | `QuoteLineInput` / `{ id, patch }` / `{ id }` / `{ quoteId, orderedIds[], groups? }` | devis recalculé |
| `quote.addKit` | `{ quoteId, laborOperationId, vehicleId? }` | lignes MO + pièces du kit |
| `quote.requestDiscountApproval` | `{ id, reason }` | `{ status: 'PENDING' }` |
| `quote.decideDiscount` | `{ id, decision: 'APPROVE' \| 'REJECT' \| 'APPROVE_PARTIAL', maxRate? }` | devis |
| `quote.preview` | `{ id }` | vue client (même rendu que le portail, lecture seule) |
| `quote.pdf` | `{ id, variant: 'customer' \| 'insurer' \| 'signed' }` | `{ url }` |
| `quote.send` | `{ id, channel: Channel \| 'LINK_ONLY' \| 'WA_LINK', recipient: { type: 'CUSTOMER' \| 'CONTACT' \| 'INSURER' \| 'CUSTOM', contactId?, address? }, message? }` | `{ quote, messageId?, waLink?, publicUrl }` |
| `quote.resend` / `quote.followUpNow` | `{ id, channel? }` | `{ messageId }` |
| `quote.recordDecision` | `{ id, channel: 'phone' \| 'in_person' \| 'whatsapp' \| 'insurer', decisions: { lineId \| groupKey, accepted, declineReason? }[], counterpartName?, signature?, messageId?, attachmentId?, sendWrittenConfirmation=true, amendment?, overrideExpiredReason? }` | devis — erreur `QUOTE_EXPIRED`, `NON_OPTIONAL_UNDECIDED` |
| `quote.createVersion` | `{ id, refreshPrices? }` | nouvelle version `DRAFT` |
| `quote.convertToRepairOrder` | `{ id, siteId?, scheduleAppointment? }` | `{ repairOrderId }` |
| `quote.convertToInvoice` | `{ id }` | `{ invoiceId }` (brouillon M08) |
| `quote.requestDeposit` | `{ id, amount? }` | `{ invoiceId, paymentLinkUrl }` (M08) |
| `quote.regenerateLink` | `{ id }` | `{ publicUrl }` |
| `quote.delete` | `{ id, reason }` | `{ ok }` (DRAFT jamais envoyé) |
| `quote.stats` | `{ from, to, siteId?, advisorId? }` | `{ sent, closed, acceptedCount, rateCount, proposedAmount, acceptedAmount, rateValue, medianDecisionHours, byAdvisor[], byPriority[], declineReasons[], recoveredByFollowups }` |
| `quote.draftExplanation` | `{ quoteId, groupKey }` | `{ text, aiInteractionId }` (M17) |
| `laborOperation.list/create/update/archive/import` | champs `LaborOperation` | opération |
| **Portail public** `portal.quote.get` | `{ token }` | vue publique (groupes, photos, totaux, état, acompte) — marque `VIEWED` |
| `portal.quote.decide` | `{ token, decisions[], signerName, signatureDataUrl?, declineReason?, contentHash }` | `{ status, acceptedTotal, deposit? }` — erreur `QUOTE_CHANGED` si `contentHash` ≠ version courante |
| `portal.quote.ask` | `{ token, message }` / `{ token, callback: true }` | `{ ok }` |

REST public (M13, scopes `quotes:read/write`) : `GET /api/v1/quotes?status&updatedSince`, `GET /api/v1/quotes/{id}`, `POST /api/v1/quotes` (création depuis un logiciel tiers, ex. pour profiter de la page d'approbation et des relances).

## 9. Automatisations et événements

**Émis** : `quote.created`, `quote.sent` (`{ quoteId, version, channel, total }`), `quote.viewed`, `quote.accepted` (inclut `PARTIALLY_ACCEPTED`, `{ acceptedTotal, declinedTotal }`), `quote.declined`, `quote.expired`, `quote.converted`, `quote.discount_approval_requested`.
| Consommateur | Usage |
|---|---|
| M04 | `AWAITING_APPROVAL` à l'envoi ; lignes approuvées/refusées et transition `approve` à la décision |
| M10 | séquence `QUOTE_FOLLOWUP` (J+2, J+5, tâche J+7 ; H+4 si véhicule sur place), arrêt sur décision/expiration/nouvelle version ; `VehicleRecommendation` → relances futures |
| M11 | envoi, confirmation écrite d'accord téléphonique, questions client dans la boîte de réception |
| M08 | facture brouillon, acompte, lien de paiement |
| M12 | taux d'acceptation, délais, motifs, montant récupéré par les relances |
| M03 | proposition de RDV pour les devis libres acceptés |

**Consommés** : `inspection.completed` (notification « Créer le devis »), `message.inbound_received` classé `QUOTE_ACCEPT`/`QUOTE_QUESTION` par M17 (suggestion « Enregistrer l'accord par WhatsApp » au conseiller, jamais automatique), `payment.received` sur facture d'acompte (badge « Acompte reçu »), `insurance_claim.approved` (M16, montant approuvé).

**Worker** : `quotes.expire` (quotidien 00:30, par fuseau d'organisation) ; `quotes.pdf` (file de génération) ; attribution « récupéré grâce aux relances » : un devis décidé après au moins une relance `QUOTE_FOLLOWUP` envoyée est marqué `Reminder.outcome = REPLIED` et compté dans M12.

**IA (M17)** : brouillon de devis à partir des doléances et de l'inspection (opérations + pièces compatibles avec le véhicule) ; explication client en français simple par groupe ; prix suggéré pour une pièce hors catalogue (historique d'achat) ; détection d'oublis (« Remplacement plaquettes sans contrôle des disques ») ; probabilité d'acceptation et meilleur moment de relance ; classement des réponses WhatsApp (« ok pour les freins seulement » → proposition de décision pré-remplie). Toute suggestion est validée par le conseiller ; journalisée dans `AiInteraction`.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Voir les devis | `quote:read` | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |
| Créer, modifier, nouvelle version | `quote:create` / `quote:update` | OWNER, MANAGER, ADVISOR |
| Envoyer, renvoyer, relancer | `quote:send` | OWNER, MANAGER, ADVISOR |
| Enregistrer une décision (téléphone, en personne, assureur) | `quote:record_decision` | OWNER, MANAGER, ADVISOR |
| Dépasser son plafond de remise / valider les remises | `quote:discount_override` | OWNER, MANAGER |
| Prix sous le minimum | `invoice:price_below_min` | OWNER |
| Supprimer un brouillon | `quote:delete` | OWNER, MANAGER |
| Voir coûts et marge prévisionnelle | `product:view_cost` | OWNER, MANAGER, STOREKEEPER, ACCOUNTANT |
| Gérer le catalogue MO | `labor_catalog:manage` | OWNER, MANAGER |
| Paramètres devis (plafonds, validité, acompte) | `settings:update` | OWNER |
| Approuver depuis le portail | jeton public | CUSTOMER |
| Statistiques | `report:read` | OWNER, MANAGER, ACCOUNTANT |

## 11. Cas limites et erreurs

| Situation | Comportement |
|---|---|
| Le client ouvre le lien alors que le conseiller vient de créer la v2 | La page affiche la v2 ; si le client validait la v1 au même moment : `QUOTE_CHANGED` → « Le devis a été mis à jour. Vérifiez les nouveaux montants. » |
| Aperçu de lien WhatsApp (robot) | User-agents de prévisualisation ignorés pour `VIEWED`. |
| Client sans smartphone | « Imprimer » + décision « En personne » avec signature tablette, ou « Par téléphone » avec confirmation SMS. |
| Client sans aucun canal écrit | Décision par téléphone autorisée ; note « Confirmation écrite impossible » ; alerte sur l'OR pour faire signer à la restitution. |
| Flotte : le responsable accepte mais la comptabilité doit valider au-delà de 500 000 FCFA | Paramètre client `requiresPurchaseOrder` (§14) : la décision portail enregistre l'accord technique ; le devis reste « En attente du bon de commande client » jusqu'à saisie du n° de BC client (`customerPoNumber`), repris sur la facture. |
| Devis accepté mais pièce devenue indisponible | Avertissement à la conversion ; la ligne passe « À commander » (M07) ; message au client avec nouveau délai (M04). |
| Prix catalogue modifié après l'envoi | Le devis garde ses prix jusqu'à `validUntil` ; « Réactiver » propose les nouveaux prix avec écarts surlignés. |
| Client accepte après expiration (l'appel arrive le lendemain) | Personnel : décision possible avec `overrideExpiredReason` (audit) ; portail : refusé, bouton « Demander l'actualisation » (notification au conseiller). |
| Remise globale qui rend une ligne négative | Impossible : la répartition est bornée à la valeur de chaque ligne ; message « Remise supérieure au montant des lignes ». |
| Lignes garantie uniquement (total client 0 FCFA) | Envoi autorisé « pour information » ; l'acceptation reste requise si l'OR l'exige. |
| Client accepte une ligne optionnelle dont la ligne principale est refusée (ex. disques sans plaquettes) | Dépendances `requiresGroupKey` (§14) : si le parent est refusé, l'enfant est désactivé avec « Nécessite : Plaquettes avant ». |
| Double clic sur « Valider mon choix » | Idempotent (statut déjà décidé → renvoie la décision enregistrée). |
| Lien transféré à un tiers | La décision enregistre IP/nom ; le personnel voit le nom du signataire et peut contester (« Annuler la décision » interdit ; créer une nouvelle version et notifier). |
| Montant très élevé (≥ 1 000 000 FCFA) | Signature obligatoire même si `requireSignature = false` ; notification au gérant à l'acceptation. |

## 12. Tests

**Unitaires (`core`)** : `quoteTotals` (exemple RG-M05-03 : 201 780 TTC, accepté 60 180 ; arrondi par ligne ; TVA désactivée) ; `allocateGlobalDiscount` (prorata, plus grand reste, borne par ligne) ; `discountAllowed(role, caps, lineRate, globalRate, overridePerm)` ; `decisionResult(lines, decisions)` (ACCEPTED / PARTIALLY / DECLINED, optionnelles non touchées, non optionnelles non décidées → erreur, groupes) ; `insuranceSplit` (franchise 100 000, part assurance, montant approuvé inférieur) ; `depositAmount` (seuil, arrondi centaine, pièces spéciales) ; `quoteStats` (exemple 65 % / 64 %, dernière version seulement, exclusion des non envoyés) ; `contentHash` stable (ordre des lignes, champs pris en compte) ; `isPreviewBot(userAgent)`.

**Intégration** : création depuis inspection (groupes, priorités, optionnels, photos) ; envoi WhatsApp (outbox) → `VIEWED` → décision portail partielle → lignes OR approuvées/refusées + réservations M07 + recommandations ; nouvelle version pendant la consultation (`QUOTE_CHANGED`) ; remise au-delà du plafond bloquant l'envoi puis validée ; expiration par le job ; relances M10 planifiées puis arrêtées à la décision ; décision téléphonique avec message de confirmation ; conversion devis libre → OR → RDV ; acompte → facture `DEPOSIT` + lien ; isolation multi-locataire et jeton public limité à un devis (un jeton ne donne accès à aucun autre document).

**E2E Playwright** : depuis l'OR-YOP-2026-00042 inspecté → « Créer le devis » → remise 15 % sur une ligne par l'advisor (bloquée) → validation par le manager → envoi WhatsApp → ouverture du lien dans un contexte mobile (390 px) → acceptation des plaquettes et des balais, refus des amortisseurs (« Je le ferai plus tard ») → signature → vérification : devis `PARTIALLY_ACCEPTED`, total accepté affiché, OR `APPROVED` avec 2 groupes approuvés, recommandation « Amortisseurs arrière » créée, relance de devis annulée.

## 13. Définition de « terminé »

- [ ] `core/money/lines`, `core/quotes` (totaux, remise globale, plafonds, décision, assurance, acompte, statistiques, hash) testés avec les exemples du PRD.
- [ ] Éditeur de devis (catalogue unifié MO/pièces/kits, groupes, disponibilité stock, remises, totaux, marge), consultation avec frise, versions et écarts.
- [ ] Création depuis inspection, depuis lignes OR en attente, libre ; conversion en OR / facture ; acompte.
- [ ] Envoi WhatsApp (API et wa.me), SMS, email avec PDF ; suivi « vu » ; relances M10 branchées.
- [ ] Page portail `/p/[token]/devis` mobile, décision par groupe, signature, preuve (hash, IP), questions/rappel.
- [ ] Décision tracée par téléphone/en personne/WhatsApp/assureur avec confirmation écrite automatique.
- [ ] Assurance : part assureur, franchise, montant approuvé et écarts.
- [ ] Catalogue MO et paramètres devis ; PDF client, assureur, signé.
- [ ] Statistiques d'acceptation exposées à M12 ; audit des remises, décisions forcées et suppressions.
- [ ] Tests unitaires, intégration et E2E verts.

## 14. Évolutions du modèle de données

```prisma
model Quote {
  // champs existants…
  origin                QuoteOrigin @default(STANDALONE)
  inspectionId          String?
  insuranceClaimId      String?
  supersedesId          String?                 // version précédente
  supersededAt          DateTime?               // renseigné quand une version plus récente existe
  globalDiscountRate    Int?                    // %
  globalDiscountAmount  Int?                    // FCFA (exclusif avec le taux)
  discountReason        String?
  discountApprovalStatus String?                // NONE | PENDING | APPROVED | REJECTED
  discountApprovedById  String?
  sentVia               String?                 // WHATSAPP | SMS | EMAIL | WA_LINK | LINK_ONLY
  sentTo                String?                 // adresse effective
  recipientContactId    String?
  decisionHash          String?                 // SHA-256 du contenu signé
  decisionIp            String?
  decisionUserAgent     String?
  decisionMessageId     String?                 // message WhatsApp servant de preuve
  recordedById          String?                 // membre ayant saisi une décision hors portail
  decisionCounterpart   String?                 // interlocuteur au téléphone
  acceptedTotal         Int      @default(0)    // TTC des lignes acceptées (dénormalisé)
  depositAmount         Int?
  depositInvoiceId      String?
  customerPoNumber      String?                 // bon de commande du client entreprise
  convertedAt           DateTime?
  deletedAt             DateTime?
  @@index([organizationId, status, sentAt])
  @@index([organizationId, repairOrderId])
  @@index([organizationId, customerId])
}
enum QuoteOrigin { REPAIR_ORDER INSPECTION STANDALONE APPOINTMENT INSURANCE }

model QuoteLine {
  // champs existants…
  organizationId      String                    // multi-locataire (RLS)
  groupKey            String?                   // regroupe MO + pièces d'un même travail
  groupLabel          String?                   // "Plaquettes avant"
  requiresGroupKey    String?                   // dépendance (ex. disques nécessite plaquettes)
  customerExplanation String?                   // texte simple affiché au client
  inspectionItemId    String?
  photoAttachmentIds  String[]
  costPrice           Int?                      // coût unitaire estimé (marge)
  isCustomerSupplied  Boolean  @default(false)
  declineReason       String?
  lineSubtotal        Int      @default(0)      // HT après remise (calculé)
  lineVat             Int      @default(0)
  lineTotal           Int      @default(0)
  @@index([quoteId])
}

model LaborOperation {
  // champs existants…
  customerDescription String?                   // explication par défaut pour le client
  defaultParts        Json     @default("[]")   // [{ productId? , category?, quantity }]
  vehicleOverrides    Json     @default("[]")   // [{ make, model?, yearFrom?, yearTo?, standardHours }]
  isServiceOperation  Boolean  @default(false)  // compte comme « révision » (M02 RG-M02-13)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  @@unique([organizationId, code])
}

model Customer {
  // ajout pour les flottes
  requiresPurchaseOrder Boolean @default(false)
}
```

Paramètres ajoutés dans `Organization.settings` : `quotes.*` (§6). Règle `ReminderRule` par défaut de type `QUOTE_FOLLOWUP` (paliers `H+4` si véhicule sur place, `J+2`, `J+5`, tâche `J+7`) semée par M01/M10.
