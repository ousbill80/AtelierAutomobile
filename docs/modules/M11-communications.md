# M11 — Communications multicanal

> Priorité : **P0** · Dépend de : M01, M02, M08, M15 · Utilisé par : M03, M04, M05, M08, M09, M10, M12, M14, M17 · Rôles concernés : OWNER, MANAGER, ADVISOR, ACCOUNTANT, CASHIER

## 1. Objectif

M11 est la **couche unique d'envoi et de réception** de tous les messages du garage : WhatsApp, SMS, email. Il garantit qu'un message part **une fois**, par le meilleur canal disponible, avec repli si le premier échoue, qu'on sait s'il a été délivré et lu, et que les réponses des clients arrivent dans une **boîte de réception unifiée** rattachée à la bonne fiche. Il fait respecter les désinscriptions (STOP) et la loi n°2013-450 (ARTCI). Aucun autre module n'appelle un fournisseur directement : tous passent par `messaging.enqueue`.

## 2. Utilisateurs et cas d'usage

| Rôle                 | Ce qu'il fait                                                                                             | Fréquence               |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| ADVISOR              | Répond aux clients dans la boîte de réception, envoie devis / véhicule prêt, utilise les réponses rapides | Continue                |
| ACCOUNTANT / CASHIER | Envoie factures, reçus, relevés ; traite les réponses « j'ai payé »                                       | Quotidienne             |
| OWNER                | Reçoit le résumé quotidien, configure les canaux, suit les coûts                                          | Quotidienne / mensuelle |
| MANAGER              | Édite les modèles, soumet les modèles WhatsApp à Meta, assigne les conversations                          | Hebdomadaire            |
| Système              | Envoie, réessaie, replie, met à jour les statuts, classe les réponses                                     | Continue                |

## 3. User stories

**US-M11-01 — En tant que système, je veux envoyer par WhatsApp avec repli SMS afin que le message arrive même si le client n'a pas WhatsApp.**

- Étant donné une relance VT pour M. Kouassi (`+2250747218890`, `hasWhatsapp = null`), canaux `[WHATSAPP, SMS]`, quand le job `messages.send` envoie via WhatsApp Cloud API et que Meta renvoie l'erreur « destinataire non WhatsApp » (code 131026 ou équivalent mappé `NOT_ON_WHATSAPP`), alors le `Message` passe `FAILED` (`errorCode = NOT_ON_WHATSAPP`), `Customer.hasWhatsapp = false`, un `Message` SMS est créé avec `fallbackOfId` et envoyé **immédiatement**, et l'historique affiche « Numéro non WhatsApp, renvoyé par SMS ».
- Étant donné un message WhatsApp `SENT` mais jamais `DELIVERED` après 6 h (`fallbackAfterMinutes = 360`), pour un type non transactionnel, alors un SMS de repli est envoyé (dans la fenêtre d'envoi), une seule fois.

**US-M11-02 — En tant qu'ADVISOR sans API WhatsApp, je veux un bouton « Ouvrir dans WhatsApp » afin d'envoyer en un clic.**

- Étant donné un canal WhatsApp configuré en `wa_link`, quand je clique « Ouvrir dans WhatsApp » sur une relance, alors l'URL `https://wa.me/2250747218890?text=<message encodé>` s'ouvre (WhatsApp Web ou application), et au retour une question « Message envoyé ? Oui / Non » ; « Oui » enregistre le `Message` `SENT` (`provider = wa_link`, sans statut de lecture).

**US-M11-03 — En tant qu'ADVISOR, je veux une boîte de réception unifiée afin de répondre à tous les clients au même endroit.**

- Étant donné que M. Kouassi répond « Oui samedi matin » à la relance VT, quand le webhook WhatsApp arrive, alors un `Message` `INBOUND` est créé, rattaché à la `Conversation` (WHATSAPP, `+2250747218890`) liée au client, `unreadCount++`, la conversation remonte en tête, l'intention IA « veut un RDV » s'affiche avec le bouton « Créer le RDV », et la relance d'origine reçoit `outcome = REPLIED`.
- Quand je réponds dans les 24 h, alors j'écris un message libre ; après 24 h, l'éditeur impose un modèle approuvé (« La fenêtre de 24 h est fermée : choisissez un modèle »).

**US-M11-04 — En tant que client, je veux pouvoir dire STOP afin de ne plus recevoir de rappels.**

- Étant donné que M. Traoré envoie « stop » par SMS ou « Arrêter » par WhatsApp, alors une `OptOut` (adresse, canal = null : tous canaux pour les rappels) est créée, `Customer.optedOutAt` renseigné, un accusé unique est envoyé (« Vous ne recevrez plus de rappels de Garage Excellence Auto. Pour les réactiver, écrivez START. »), toutes ses relances non transactionnelles sont annulées (M10), et la conversation affiche le badge « Désinscrit ».
- Il recevra encore, s'il vient à l'atelier, « véhicule prêt » et sa facture (transactionnels, `02` §3).

**US-M11-05 — En tant que MANAGER, je veux éditer un modèle avec aperçu et compteur SMS afin de maîtriser le coût.**

- Étant donné le modèle `cr_jp3` SMS, quand je tape « Réglement » (avec é), alors le compteur affiche « 112 caractères · 1 SMS · GSM-7 » ; si j'ajoute « ê », il affiche « UCS-2 : 112/70 → 2 SMS » en orange avec la suggestion « Remplacer ê par e ».
- Quand je soumets le modèle WhatsApp `vt_j30` à Meta, alors `whatsappStatus = PENDING`, et le webhook `message_template_status_update` le passe à `APPROVED` ou `REJECTED` (motif affiché).

**US-M11-06 — En tant qu'OWNER, je veux un résumé chaque matin afin de savoir où agir.**

- Étant donné le 19/10/2026 à 07:30, alors je reçois sur WhatsApp : « Bonjour M. Diallo, voici Garage Excellence Auto ce lundi 19/10 : 23 relances à traiter, 4 850 000 FCFA dus (1 920 000 à +30 j), hier 315 000 FCFA encaissés dont 185 000 grâce aux relances, 6 RDV aujourd'hui, 2 promesses à vérifier (SOTRA Logistique 600 000). 3 envois ont échoué. Détails : <lien> ».

**US-M11-07 — En tant que développeur, je veux voir tous les messages en local sans compte fournisseur.**

- Étant donné `NODE_ENV=development` et des canaux `console`, quand un message est envoyé, alors il apparaît dans `/dev/outbox` (rendu WhatsApp/SMS/email) et dans les logs ; un bouton « Simuler une réponse » injecte un message entrant comme un webhook réel ; des boutons simulent `DELIVERED`, `READ`, `FAILED(NOT_ON_WHATSAPP)`.

## 4. Règles métier

### 4.1 Mise en file et idempotence

**RG-M11-01 — Point d'entrée unique.** `messaging.enqueue(tx, req)` (fonction serveur, appelée dans la transaction de l'appelant) :

```ts
type EnqueueRequest = {
  idempotencyKey: string; // "rem:<groupKey>", "inv:<invoiceId>:issued", "rcpt:<paymentId>"
  kind: "reminder" | "transactional" | "conversation" | "digest" | "system";
  customerId?: string;
  conversationId?: string;
  to: { phone?: string; whatsapp?: string; email?: string; name?: string };
  channels: Channel[]; // ordre de préférence (repli)
  templateKey?: string;
  context?: TemplateContext;
  bodyOverride?: string;
  subjectOverride?: string;
  attachments?: { kind: "pdf" | "image"; storageKey: string; filename: string }[];
  reminderIds?: string[];
  sentById?: string | null;
  notBefore?: Date; // respect de la fenêtre d'envoi de l'appelant
};
```

Crée un `Message` `QUEUED` pour le **premier canal disponible** (RG-M11-05), puis, **après commit**, ajoute le job BullMQ `messages.send` (`jobId = message.id`). `idempotencyKey` unique par organisation : un second appel renvoie le message existant sans rien créer.

**RG-M11-02 — Conformité avant tout envoi** (dans `messages.send`, juste avant l'appel fournisseur) :

1. Adresse ∈ `OptOut` (canal exact ou `null`) et `kind ≠ transactional` → `FAILED` `OPTED_OUT`, pas de repli.
2. `Customer.remindersConsent = false` et `kind = reminder` → `FAILED` `NO_CONSENT`.
3. `Customer.phoneInvalidAt` non nul pour ce numéro → passer au canal suivant.
4. Heure locale hors 07:00-21:00 et `kind ∈ {reminder, digest}` → report au lendemain 08:00 (filet de sécurité, M10 gère déjà la fenêtre).
5. Canal `isActive = false` ou `status = ERROR` → canal suivant.

**RG-M11-03 — Rendu.** Moteur Handlebars **sans helpers personnalisés exécutables** (`noEscape` pour SMS/WhatsApp, échappement HTML pour l'email) ; helpers autorisés : `formatMoney`, `formatDate`, `upper`. Variable manquante ou vide → **blocage** de l'envoi (`FAILED` `TEMPLATE_VARIABLE_MISSING`, détail « {{lien.paiement}} vide : aucun fournisseur de paiement configuré ») plutôt qu'un message avec un trou. Exception : variables marquées optionnelles dans le catalogue (`{{garage.horaires}}`). `Message.body` stocke le texte **final** envoyé.

### 4.2 Canaux et repli

**RG-M11-04 — Fournisseurs** (interface `MessagingProvider`, `01` §10), configurés par organisation dans `ChannelConfig` :

| Canal    | `provider`        | Notes                                                                                                                           |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| WHATSAPP | `whatsapp_cloud`  | Numéro WhatsApp Business vérifié chez Meta ; credentials : `phoneNumberId`, `wabaId`, `accessToken`, `appSecret`, `verifyToken` |
| WHATSAPP | `wa_link`         | Pas d'API : envoi humain via `wa.me` ; aucun envoi automatique possible, aucun statut                                           |
| SMS      | `orange_sms`      | Orange SMS API Côte d'Ivoire (OAuth2 client credentials, nom d'expéditeur à faire valider par l'opérateur)                      |
| SMS      | `twilio`          | Expéditeur alphanumérique selon disponibilité pays                                                                              |
| SMS      | `http_sms`        | Agrégateur local générique : URL, méthode, gabarit de corps JSON/form, mapping de réponse, URL de rapport de livraison          |
| EMAIL    | `resend` / `smtp` | Domaine expéditeur avec SPF/DKIM vérifiés (assistant M15)                                                                       |
| *        | `console`         | Développement et tests                                                                                                          |

**RG-M11-05 — Choix et repli.** Ordre reçu de l'appelant (M10 RG-M10-12), filtré par RG-M11-02. Déclencheurs de repli vers le canal suivant :

| Situation                                                                                                           | Repli                                  | Délai              |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------ |
| Erreur définitive (numéro non WhatsApp, numéro invalide, modèle non approuvé, adresse email rejetée)                | Oui                                    | Immédiat           |
| Erreurs temporaires épuisées (RG-M11-07)                                                                            | Oui                                    | Immédiat           |
| WhatsApp `SENT` sans `DELIVERED` après `fallbackAfterMinutes` (défaut 360 ; 30 pour `VEHICLE_READY`, `APPOINTMENT`) | Oui (une fois)                         | Délai paramétrable |
| SMS sans accusé de livraison                                                                                        | Non (les accusés SMS sont peu fiables) | —                  |
| `DELIVERED`/`READ`                                                                                                  | Jamais                                 | —                  |

Un repli crée un **nouveau** `Message` (`fallbackOfId` = message d'origine) ; un même `idempotencyKey` produit au plus **un message par canal**. Le repli d'une relance utilise le modèle du même `templateKey` pour le nouveau canal. Si tous les canaux échouent : événement `message.failed_all` → M10 met la relance `FAILED`, notification à l'ADVISOR.

**RG-M11-06 — Détection WhatsApp.** `Customer.hasWhatsapp` : `true` au premier `DELIVERED` WhatsApp ou message entrant WhatsApp ; `false` sur erreur `NOT_ON_WHATSAPP` ; revérifié (remis à `null`) 90 jours après un `false` ou à chaque changement de numéro. Une fois `false`, M10 ne propose plus WhatsApp.

**RG-M11-07 — Retries.** Erreurs temporaires (timeout, 5xx, limitation de débit fournisseur, réseau) : 5 tentatives, backoff exponentiel 30 s, 2 min, 8 min, 30 min, 2 h (+ gigue 20 %). Erreurs définitives : aucune nouvelle tentative. Chaque tentative journalisée (`MessageAttempt`, §14). La table `providerErrorMap` dans chaque adaptateur classe les codes fournisseurs en `TEMPORARY` / `PERMANENT_RECIPIENT` / `PERMANENT_TEMPLATE` / `PERMANENT_CONFIG` / `RATE_LIMIT`. `PERMANENT_CONFIG` (jeton expiré, crédit épuisé) : canal passé `status = ERROR`, alerte « Canal SMS en erreur : crédit épuisé » à l'OWNER, messages suivants reroutés vers le canal suivant.

**RG-M11-08 — Limitation de débit.** Limiteur BullMQ par `organizationId:channel` (valeurs par défaut prudentes, paramétrables dans M15 sous « Avancé ») : WhatsApp 20 msg/s, SMS 5 msg/s, email 10 msg/s ; plus un plafond quotidien WhatsApp cohérent avec le **palier de messagerie** du numéro chez Meta (le palier, saisi ou lu depuis l'API, limite le nombre de destinataires uniques par 24 h pour les conversations initiées par l'entreprise) ; au-delà, report au lendemain + alerte. Un envoi groupé de 300 relances est donc lissé.

**RG-M11-09 — Coûts.** Les prix fournisseurs ne sont **pas** codés en dur. `Message.cost` (FCFA entier) = coût renvoyé par le fournisseur s'il existe, sinon estimation à partir du **barème saisi par le garage** dans M15 (`settings.messaging.costs` : prix par segment SMS, prix par conversation WhatsApp par catégorie, email). Affichage : coût estimé avant un envoi groupé, coût du mois par canal dans « Historique », alerte si le budget mensuel `settings.messaging.monthlyBudget` est dépassé à 80 % puis 100 % (à 100 %, envois `reminder` mis en validation ; transactionnels non bloqués). Solde SMS : `ChannelConfig.balance` interrogé chaque heure si l'API le permet ; alerte sous le seuil (défaut 200 SMS).

### 4.3 WhatsApp Cloud API

**RG-M11-10 — Fenêtre de 24 h.** `Conversation.whatsappWindowExpiresAt = dernier message entrant WhatsApp + 24 h`. Dans la fenêtre : texte libre, images, documents autorisés. Hors fenêtre : uniquement un **modèle approuvé** (`MessageTemplate.whatsappStatus = APPROVED`) avec paramètres. Le moteur choisit : fenêtre ouverte → message libre avec `body` rendu ; sinon → modèle (`whatsappTemplateName`, `whatsappLanguage`, paramètres positionnels `{{1}}…{{n}}` dérivés des variables, RG-M11-12). Pas de modèle approuvé → WhatsApp retiré pour cet envoi (repli).

**RG-M11-11 — Statuts et webhooks.** `POST /api/webhooks/whatsapp` (vérification `X-Hub-Signature-256` avec `appSecret` ; `GET` de vérification avec `hub.verify_token`). Statuts `sent → delivered → read`, `failed` (code, titre). Mise à jour **monotone** : un statut n'écrase jamais un statut plus avancé (les webhooks arrivent dans le désordre) ; ordre `QUEUED < SENDING < SENT < DELIVERED < READ` ; `FAILED` n'écrase que `QUEUED/SENDING/SENT`. Idempotence par `(providerMessageId, status)`. Routage multi-organisation : par `phone_number_id` → `ChannelConfig`. Réponse 200 en < 2 s ; traitement dans la file `webhooks.inbound`.

**RG-M11-12 — Modèles WhatsApp.** Lors de la soumission (`templates.submitWhatsapp`) : conversion des variables `{{client.salutation}}` en `{{1}}`, `{{2}}`… dans l'ordre d'apparition, stockage du mapping (`whatsappParamMap`), exemples de valeurs obligatoires (pris du jeu de démonstration), catégorie proposée (`UTILITY` pour rappels d'échéance, créances, RDV, véhicule prêt, factures ; `MARKETING` pour satisfaction et relances commerciales), langue `fr`. Nom Meta : `{orgSlug}_{key}_v{n}` (minuscules, `_`). Toute modification d'un modèle approuvé crée une **nouvelle version** soumise ; l'ancienne reste utilisée jusqu'à approbation. Webhook `message_template_status_update` → `whatsappStatus` + `whatsappRejectedReason`. Meta peut reclasser la catégorie : la catégorie effective est stockée et affichée. Boutons : « Répondre », « Appeler le garage » et boutons URL (`{{lien.paiement}}`) quand le modèle le prévoit.

**RG-M11-13 — Médias.** Documents PDF (facture, devis, relevé, mise en demeure) envoyés comme `document` WhatsApp via URL signée valable 1 h, ou pièce jointe email ; en SMS, remplacés par le lien portail court. Médias entrants (photos, notes vocales, PDF) téléchargés depuis Meta par le worker, stockés S3 (`Attachment`, `entity = message`), type MIME contrôlé, taille max 16 Mo.

### 4.4 SMS

**RG-M11-14 — Encodage et segments** (`core/messaging/smsSegments`) : si tous les caractères ∈ alphabet GSM 03.38 (table de base + extension `^{}\[~]|€` comptés 2) → GSM-7 : 160 car. pour 1 segment, 153 par segment au-delà ; sinon UCS-2 : 70, puis 67 par segment. Caractères français : é è à ù ì ò É Ç sont GSM-7 ; **ê â î ô û ç ë ï œ « » ’ « … » ne le sont pas**. Option `settings.messaging.smsTransliterate` (défaut **true**) : avant envoi, remplacement ê→e, â→a, î→i, ô→o, û→u, ç→c, ë→e, ï→i, œ→oe, ’→', « »→", …→... ; le compteur de l'éditeur montre le résultat après translittération. Limite dure : 3 segments (459 car. GSM-7) par défaut ; au-delà, refus à l'enregistrement du modèle et troncature interdite à l'envoi (on bloque plutôt que d'envoyer un texte coupé).

**RG-M11-15 — Expéditeur SMS.** `ChannelConfig.senderId` : nom alphanumérique ≤ 11 caractères (ex. `EXCELAUTO`), à faire enregistrer auprès de l'opérateur/agrégateur. Un expéditeur alphanumérique ne reçoit pas de réponse : les modèles SMS ne disent pas « répondez » (M10 annexe A) ; les réponses SMS n'existent que si le fournisseur fournit un numéro long/court entrant (webhook `POST /api/webhooks/sms/{provider}`).

**RG-M11-16 — Accusés SMS.** `POST /api/webhooks/sms/{provider}` (signature HMAC ou jeton secret dans l'URL selon fournisseur) → `DELIVERED`/`FAILED`. Absence d'accusé après 48 h : statut laissé `SENT`.

### 4.5 Email

**RG-M11-17 — Email.** Gabarits React Email (`packages/emails`) : mise en page commune (logo, couleur du garage, coordonnées, mentions RCCM/NCC), corps issu du modèle, bouton d'action principal (« Payer », « Voir le devis »), pied « Ne plus recevoir de rappels » (lien de désinscription signé → `OptOut` canal EMAIL ; en-tête `List-Unsubscribe` + `List-Unsubscribe-Post`). Texte brut généré automatiquement. `Reply-To` = adresse de la boîte de réception du garage si la réception email est configurée (Resend inbound ou relève IMAP, P1), sinon email du garage. Rebonds définitifs / plaintes (webhook `POST /api/webhooks/email/{provider}`) → email marqué invalide (`Customer.emailInvalidAt`) et, pour une plainte, `OptOut` EMAIL.

### 4.6 Réception et boîte unifiée

**RG-M11-18 — Rattachement.** Message entrant → normalisation de l'adresse (`core/phone`) → `Conversation` unique `(organizationId, channel, externalAddress)` (créée si absente) → client : recherche `Customer.phone`, `phone2`, `whatsappPhone`, `CustomerContact.phone`, `Vehicle.driverPhone` (non supprimés). 1 client → rattaché. Plusieurs clients (numéro partagé, doublon) → `customerId = null`, badge « 2 clients possibles » avec choix manuel (mémorisé). Aucun → « Numéro inconnu », action « Créer le client » (pré-rempli avec le nom de profil WhatsApp).

**RG-M11-19 — Désinscription.** Mots-clés (insensibles à la casse, accents et ponctuation, message **entier** ≤ 3 mots) : `STOP`, `ARRET`, `ARRÊT`, `ARRETER`, `DESABONNER`, `DÉSINSCRIRE`, `STOP RAPPEL`, `UNSUBSCRIBE`. Réactivation : `START`, `REPRENDRE`. « Stop, j'ai déjà payé » (> 3 mots) n'est **pas** une désinscription automatique : l'IA le classe et la conversation est signalée « Désinscription probable » pour confirmation humaine. Accusé de désinscription envoyé une seule fois (dans la fenêtre 24 h pour WhatsApp, donc message libre). Émet `customer.opted_out` (M10 annule).

**RG-M11-20 — Intention (M17).** Chaque message entrant texte (hors mots-clés) est classé par le service `ai` : `APPOINTMENT_REQUEST` (« veut un RDV »), `PAID_CLAIM` (« a payé »), `DISPUTE` (« conteste »), `PRICE_REQUEST` (« demande prix »), `PROMISE` (« paiera le… », avec date/montant extraits), `ALREADY_DONE` (« VT déjà faite », date extraite), `WRONG_PERSON` (« ce n'est pas moi / j'ai vendu la voiture »), `OPT_OUT_LIKELY`, `THANKS`, `OTHER`. Sortie : `{ intent, confidence, entities }`, stockée dans `Message.intent` et `Conversation.lastIntent`, tracée dans `AiInteraction`. **L'IA propose, l'humain valide** : chaque intention affiche une action suggérée (Créer le RDV pré-rempli, Vérifier le paiement, Ouvrir un litige, Noter la promesse, Saisir la nouvelle date de VT, Détacher le véhicule) ; aucune action à effet n'est exécutée seule. Seuls effets automatiques : pause de séquence (M10 RG-M10-22, M09 RG-M09-08). Confiance < 0,6 → `OTHER`. Sans IA configurée : pas de classement, tout reste manuel.

> Étape 6.2 (M17) : le catalogue d'intentions retenu est celui de M17 RG-M17-11 (`BOOK_APPOINTMENT`, `PAYMENT_DONE`, `PAYMENT_PROMISE`, `OPT_OUT`, `COMPLAINT`…), propriétaire du classement ; les intentions M11 `DISPUTE`, `ALREADY_DONE` et `WRONG_PERSON` ne sont pas distinguées (classées `COMPLAINT`/`OTHER`). Sans IA (désactivée, hors quota, en panne), un repli par mots-clés classe quand même le message. Effets automatiques sans effet externe : intention, assignation d'une réclamation au gérant, tâche « Vérifier le paiement annoncé » ; désinscription et promesse restent des suggestions. La pause de séquence reste celle de M10 (`reminders.on_event`).

**RG-M11-21 — Assignation et statuts.** Nouvelle conversation entrante → assignée au conseiller de la dernière relance/OR du client, sinon non assignée (file commune). `Conversation.status` : `OPEN` (à traiter), `PENDING` (en attente du client), `CLOSED`. Message entrant sur `PENDING`/`CLOSED` → `OPEN`. Notification interne au destinataire assigné ; si non lue depuis 2 h ouvrées → rappel au MANAGER.

**RG-M11-22 — Réponses rapides.** `QuickReply` (titre, texte avec variables, raccourci `/prix-vidange`) partagées dans l'organisation ; insérables dans la zone de saisie ; hors fenêtre 24 h, seules les réponses rapides liées à un modèle approuvé sont proposées.

### 4.7 Transactionnels et résumé

**RG-M11-23 — Messages transactionnels** (`kind = transactional`, non soumis à `remindersConsent` ni à OptOut « rappels », mais soumis à une OptOut explicite de canal demandée via l'équipe) :

| Clé          | Déclencheur            | Contenu                                                                 | Pièce jointe               |
| ------------ | ---------------------- | ----------------------------------------------------------------------- | -------------------------- |
| `tx_devis`   | `quote.sent` (M05)     | Devis n°, montant, lien d'acceptation                                   | PDF devis (WhatsApp/email) |
| `tx_facture` | `invoice.issued` (M08) | Facture n°, montant, solde, lien paiement                               | PDF facture FNE            |
| `tx_recu`    | `payment.received`     | « Nous avons bien reçu 185 000 FCFA par Wave. Merci ! » + solde restant | PDF reçu                   |
| `tx_pret`    | OR → `READY`           | = M10 `pret_j0`                                                         | —                          |
| `tx_rdv`     | `appointment.created`  | = M10 `rdv_confirm`                                                     | —                          |
| `tx_releve`  | M09 relevé             | Lien relevé                                                             | PDF relevé                 |
| `tx_otp`     | Auth / portail         | Code à 6 chiffres                                                       | —                          |

`idempotencyKey` = `{clé}:{entityId}:{version}` (une facture réémise après avoir = nouvelle version).

**RG-M11-24 — Résumé quotidien du gérant** (`digest.owner`, 07:30 fuseau org, jours ouvrés + option samedi). Destinataires : membres OWNER (et MANAGER si coché), canal choisi (WhatsApp modèle `digest_owner` UTILITY, ou email détaillé). Contenu : relances à traiter, envoyées hier (délivrées/lues/échecs), encaissé hier et part attribuée aux relances, total dû / +30 j, promesses du jour et rompues, dossiers escaladés, RDV du jour, véhicules prêts non récupérés, alertes (canal en erreur, crédit SMS faible, dernier import > 48 h). Rien à signaler → message court « Tout est à jour ». Le résumé n'est pas compté dans les plafonds clients.

### 4.8 Journal et dev

**RG-M11-25 — Historique.** Tous les `Message` sont conservés 24 mois (puis corps anonymisé, métadonnées conservées pour les statistiques). Export Excel. Suppression d'un client (droit ARTCI) : corps des messages remplacés par « [supprimé] », adresses hachées.

**RG-M11-26 — Mode console.** Provider `console` : écrit le message dans les logs pino et dans la table de dev, statut `SENT` puis `DELIVERED` après 2 s. Page `/dev/outbox` (accessible uniquement si `APP_ENV ≠ production`) : liste temps réel, rendu par canal, boutons « Simuler livré / lu / échec (code) / réponse entrante (texte libre) / STOP ». Un garde au démarrage refuse un provider `console` actif en production.

## 5. Machine à états

### 5.1 `Message.status` (sortant)

`QUEUED → SENDING → SENT → DELIVERED → READ` ; `QUEUED|SENDING|SENT → FAILED`. Entrant : `RECEIVED`.

| Transition                | Déclencheur                                      | Effets                                                     |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `QUEUED → SENDING`        | worker prend le job                              | tentative journalisée                                      |
| `SENDING → SENT`          | réponse fournisseur OK (`providerMessageId`)     | `sentAt`, `message.status_changed` (M10 : Reminder `SENT`) |
| `SENDING → QUEUED`        | erreur temporaire                                | retry planifié                                             |
| `→ FAILED`                | erreur définitive / retries épuisés / conformité | repli éventuel (RG-M11-05)                                 |
| `SENT → DELIVERED → READ` | webhooks                                         | `deliveredAt`, `readAt` ; `hasWhatsapp = true`             |

### 5.2 `Conversation.status` : `OPEN ⇄ PENDING → CLOSED` ; entrant → `OPEN`.

### 5.3 `MessageTemplate.whatsappStatus` : `null → PENDING → APPROVED | REJECTED` ; `APPROVED → PAUSED/DISABLED` si Meta le signale (qualité) → alerte et repli SMS.

## 6. Données

Entités de `02` : `Message`, `Conversation`, `MessageTemplate`, `ChannelConfig`, `OptOut`, `Customer` (`hasWhatsapp`, `whatsappPhone`, `preferredChannel`, `remindersConsent`, `optedOutAt`), `CustomerContact`, `Attachment`, `Notification`, `AiInteraction`, `DomainEvent`. Paramètres `Organization.settings.messaging` :

```json
{
  "fallbackAfterMinutes": 360,
  "smsTransliterate": true,
  "maxSmsSegments": 3,
  "quietHours": { "from": "21:00", "to": "07:00" },
  "monthlyBudget": null,
  "costs": { "smsPerSegment": null, "whatsappUtility": null, "whatsappMarketing": null },
  "lowSmsBalance": 200,
  "digest": { "time": "07:30", "channel": "WHATSAPP", "saturday": false, "includeManagers": false }
}
```

Ajouts : §14.

## 7. Écrans et interface

### 7.1 Messages (boîte de réception) — `/messages`

- 3 colonnes (PC) : liste des conversations (filtres : Toutes, Non lues, Assignées à moi, Non assignées, par intention, par canal ; recherche nom/téléphone/plaque) · fil de discussion (bulles, statuts ✓ envoyé / ✓✓ délivré / ✓✓ bleu lu, échec en rouge avec motif ; relances système affichées avec leur badge type/palier ; pièces jointes) · panneau client (fiche résumée, véhicules, solde dû, relances en cours, OR ouvert, actions rapides : Créer RDV, Enregistrer un paiement, Noter une promesse, Ne plus relancer).
- Bandeau d'intention IA au-dessus du dernier message entrant : « Veut un RDV — samedi matin » [Créer le RDV] [Ignorer].
- Zone de saisie : texte, réponses rapides (`/`), variables, pièce jointe, choix du canal ; indicateur « Fenêtre WhatsApp ouverte encore 18 h » ou « Fenêtre fermée : modèle requis » (sélecteur de modèles approuvés).
- Actions : assigner, statut (Ouvert/En attente/Fermé), rattacher à un client, créer le client.
- Mobile : liste → fil en plein écran → panneau client en tiroir.
- États vides : « Aucun message. Les réponses de vos clients arriveront ici. »

### 7.2 Historique des envois — `/messages/historique`

Tableau : date/heure, client, type (relance + palier / transactionnel / conversation), canal, statut, coût, envoyé par (ou « Automatique »), repli (« → SMS »). Filtres : période, canal, statut, type, client. Détail : corps exact envoyé, tentatives, codes d'erreur traduits en français (« Numéro non WhatsApp », « Crédit SMS épuisé », « Modèle non approuvé par Meta »), chaîne de repli. Totaux du mois et coût par canal. Export Excel.

### 7.3 Modèles — `/parametres/modeles`

- Liste par type et palier (« VT — J-30 », « Créance — relance ferme ») avec pastilles des canaux et statut Meta.
- Éditeur : onglets WhatsApp / SMS / Email (objet + corps) ; **puces de variables** cliquables issues du catalogue (`02` §4 + M10 §14) ; aperçu réaliste (bulle WhatsApp, écran SMS avec compteur « 138 car. · 1 SMS · GSM-7 », email rendu) avec données d'exemple choisissables (« Kouassi Jean-Marc / 2547 GH 01 ») ; alertes : variable inconnue, SMS > 1 segment, caractère UCS-2, lien manquant dans une relance de créance, « répondez » dans un SMS.
- Statut Meta : Non soumis / En attente / Approuvé (catégorie) / Refusé (motif) ; bouton « Soumettre à Meta » ; versions.
- Bouton « Réinitialiser au modèle par défaut » ; « Envoyer un test à mon numéro ».

### 7.4 Canaux — `/parametres/canaux`

Cartes WhatsApp, SMS, Email : statut (Connecté / Non configuré / Erreur + motif), fournisseur, expéditeur, solde SMS, palier de messagerie WhatsApp, « Configurer » (assistant : identifiants, URL de webhook à copier, `verify_token` généré), « Envoyer un test », « Vérifier maintenant ». Ordre de repli global par défaut. Barème des coûts et budget mensuel.

## 8. API

Routeur `messaging` :

| Procédure                                                                    | Entrée                                                                                        | Sortie                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `messaging.conversations.list`                                               | `{ filter, channel?, intent?, assignedToMe?, search?, cursor }`                               | `{ items, nextCursor, unreadTotal }`                                          |
| `messaging.conversations.get`                                                | `{ id, cursor? }`                                                                             | conversation + messages paginés + `windowExpiresAt` + client                  |
| `messaging.conversations.reply`                                              | `{ conversationId, body?, templateKey?, quickReplyId?, attachments? }`                        | Message                                                                       |
| `messaging.conversations.assign` / `setStatus` / `linkCustomer` / `markRead` | …                                                                                             | Conversation                                                                  |
| `messaging.send`                                                             | `{ customerId, channel?, templateKey?, body?, context?, attachments? }` (envoi manuel ad hoc) | Message                                                                       |
| `messaging.waLink`                                                           | `{ reminderId? , customerId, body }`                                                          | `{ url }`                                                                     |
| `messaging.waLinkConfirm`                                                    | `{ reminderId?, customerId, body, sent: boolean }`                                            | Message?                                                                      |
| `messaging.history`                                                          | `{ from, to, channel?, status?, kind?, customerId?, cursor }`                                 | `{ items, totals }`                                                           |
| `messaging.message.get`                                                      | `{ id }`                                                                                      | Message + tentatives + chaîne de repli                                        |
| `messaging.estimateCost`                                                     | `{ items: [{ channel, body }] }`                                                              | `{ perChannel, total, segments }`                                             |
| `templates.list` / `get` / `upsert` / `reset`                                | …                                                                                             | MessageTemplate                                                               |
| `templates.preview`                                                          | `{ key, channel, sampleCustomerId?, body? }`                                                  | `{ rendered, sms: { chars, segments, encoding, nonGsmChars[] }, warnings[] }` |
| `templates.submitWhatsapp`                                                   | `{ templateId, category }`                                                                    | MessageTemplate (`PENDING`)                                                   |
| `templates.sendTest`                                                         | `{ templateId, to }`                                                                          | Message                                                                       |
| `quickReplies.list` / `upsert` / `delete`                                    | …                                                                                             | QuickReply                                                                    |
| `channels.list` / `upsert` / `test` / `healthCheck`                          | `{ channel, provider, credentials, senderId }` …                                              | ChannelConfig (sans secrets)                                                  |
| `optOuts.list` / `add` / `remove`                                            | `{ address, channel?, reason }`                                                               | OptOut                                                                        |
| `digest.preview`                                                             | —                                                                                             | texte du résumé du jour                                                       |

Webhooks (route handlers, sans session, signature vérifiée, réponse rapide puis file `webhooks.inbound`) :

- `GET|POST /api/webhooks/whatsapp` — statuts, messages entrants, `message_template_status_update`, alertes de qualité.
- `POST /api/webhooks/sms/[provider]` — accusés de livraison, SMS entrants.
- `POST /api/webhooks/email/[provider]` — livré, rebond, plainte, email entrant (P1).
- `GET /api/u/[token]` — désinscription email (page de confirmation en français).

## 9. Automatisations et événements

| Job / file                        | Fréquence    | Rôle                                                       |
| --------------------------------- | ------------ | ---------------------------------------------------------- |
| `messages.send` (file `messages`) | à la demande | Conformité, rendu, appel fournisseur, statut, repli        |
| `messages.fallback_check`         | 5 min        | WhatsApp `SENT` non délivrés au-delà du délai → repli      |
| `webhooks.inbound`                | à la demande | Statuts monotones, entrants, rattachement, STOP, intention |
| `channels.health`                 | horaire      | `healthCheck`, solde SMS, alertes                          |
| `digest.owner`                    | 07:30        | RG-M11-24                                                  |
| `messages.retention`              | mensuel      | Anonymisation > 24 mois                                    |

Émet : `message.status_changed`, `message.failed_all`, `message.inbound_received` (avec `intent`), `customer.opted_out`, `customer.opted_in`, `channel.error`. Consomme : `quote.sent`, `invoice.issued`, `payment.received`, `repair_order.status_changed`, `appointment.created/updated/cancelled` (messages transactionnels).

## 10. Permissions

| Action                        | Permission          | OWNER | MANAGER | ADVISOR | ACCOUNTANT | CASHIER |
| ----------------------------- | ------------------- | :---: | :-----: | :-----: | :--------: | :-----: |
| Lire la boîte de réception    | `message:read`      |  ✅   |   ✅    |   ✅    |     ✅     |   ✅    |
| Répondre / envoyer un message | `message:send`      |  ✅   |   ✅    |   ✅    |     ✅     |   ✅    |
| Assigner / fermer             | `message:assign`    |  ✅   |   ✅    |   ✅    |     —      |    —    |
| Historique et coûts           | `message:history`   |  ✅   |   ✅    |   ✅    |     ✅     |    —    |
| Modèles, réponses rapides     | `template:manage`   |  ✅   |   ✅    |    —    |     —      |    —    |
| Soumettre à Meta              | `template:submit`   |  ✅   |   ✅    |    —    |     —      |    —    |
| Canaux, identifiants, budget  | `settings:channels` |  ✅   |    —    |    —    |     —      |    —    |
| Gérer les désinscriptions     | `optout:manage`     |  ✅   |   ✅    |    —    |     —      |    —    |

## 11. Cas limites et erreurs

| Situation                                                           | Comportement                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job rejoué après crash pendant l'appel fournisseur                  | `providerMessageId` déjà présent → aucun renvoi ; état `SENDING` > 10 min sans id → vérification par API de statut si disponible, sinon `FAILED` `UNKNOWN_STATE` avec revue manuelle (on préfère ne pas risquer un double envoi) |
| Webhook dupliqué ou désordonné                                      | Idempotence + statut monotone                                                                                                                                                                                                    |
| Webhook à signature invalide                                        | 401, journalisé, aucun traitement                                                                                                                                                                                                |
| Jeton WhatsApp expiré                                               | `PERMANENT_CONFIG` → canal en erreur, bandeau rouge, repli SMS                                                                                                                                                                   |
| Modèle WhatsApp refusé                                              | Envois WhatsApp hors fenêtre de ce modèle → SMS ; alerte sur l'écran Modèles                                                                                                                                                     |
| Client répond sur WhatsApp à un SMS                                 | Conversation WhatsApp distincte, même client ; le panneau client montre les deux canaux                                                                                                                                          |
| Numéro partagé (famille, chauffeur)                                 | RG-M11-18 : choix manuel                                                                                                                                                                                                         |
| Numéro saisi `0708123456` (ancien format 8 chiffres ou 10 chiffres) | `core/phone` normalise en `+2250708123456` ; numéro à 8 chiffres → rejet à la saisie « Numéro ivoirien à 10 chiffres attendu »                                                                                                   |
| Message entrant d'un inconnu « Prix vidange Corolla ? »             | Conversation non rattachée, intention `PRICE_REQUEST`, action « Créer le client »                                                                                                                                                |
| Note vocale entrante                                                | Stockée, lisible ; pas de classement IA (P2 : transcription)                                                                                                                                                                     |
| Crédit SMS épuisé pendant un envoi groupé                           | Messages restants repliés vers email ou mis `FAILED` ; alerte                                                                                                                                                                    |
| Variable `{{lien.paiement}}` vide                                   | Blocage RG-M11-03, motif clair                                                                                                                                                                                                   |
| Budget mensuel atteint                                              | Relances passées en validation ; transactionnels envoyés                                                                                                                                                                         |
| Email du client invalide (rebond)                                   | `emailInvalidAt`, plus d'envoi email jusqu'à correction                                                                                                                                                                          |
| `console` actif en production                                       | Démarrage refusé                                                                                                                                                                                                                 |

## 12. Tests

**Unitaires `packages/core/messaging`** : `smsSegments` (160/161/153×2/70/71/67, extension `€` = 2, accents GSM vs UCS-2), `transliterate`, `isStopKeyword` (« stop », « Arrêt ! », « STOP RAPPEL » → oui ; « stop j'ai payé hier » → non), `nextStatus` monotone, `pickChannel` (OptOut, invalide, fixe, inactif), `fallbackDecision` (chaque ligne RG-M11-05), `toWhatsappParams` (conversion et ordre des paramètres), `renderTemplate` (variable manquante → erreur, échappement HTML email).
**Adaptateurs** : contrats `MessagingProvider` testés avec réponses enregistrées (fixtures) de chaque fournisseur ; `providerErrorMap`.
**Intégration** : `enqueue` deux fois même `idempotencyKey` → un message ; NOT_ON_WHATSAPP → SMS immédiat et `hasWhatsapp = false` ; webhook READ avant DELIVERED ; STOP → OptOut + annulation relances M10 ; isolement multi-locataire (webhook d'un `phone_number_id` d'une autre organisation).
**E2E Playwright** : configurer canaux `console` → envoyer une relance → `/dev/outbox` « Simuler échec NOT_ON_WHATSAPP » → SMS de repli visible → « Simuler réponse : Oui samedi » → `/messages` : conversation non lue, intention « Veut un RDV », créer le RDV → relance d'origine `REPLIED` ; éditer le modèle SMS avec « ê » → compteur UCS-2 et suggestion.

## 13. Définition de « terminé »

- [ ] Adaptateurs `whatsapp_cloud`, `wa_link`, `orange_sms`, `twilio`, `http_sms`, `resend`, `smtp`, `console` derrière `MessagingProvider`, testés par fixtures.
- [ ] `messaging.enqueue` idempotent, repli et retries conformes ; webhooks signés, idempotents, monotones.
- [ ] Fenêtre 24 h WhatsApp gérée ; soumission et suivi des modèles Meta.
- [ ] Boîte de réception (PC + mobile) avec rattachement, assignation, réponses rapides, pièces jointes, intention IA à valider.
- [ ] STOP / START opérationnels ; OptOut respectée partout (test dédié).
- [ ] Éditeur de modèles avec aperçu par canal et compteur SMS exact.
- [ ] Messages transactionnels branchés sur M05, M08, M03, M04.
- [ ] Résumé quotidien du gérant.
- [ ] `/dev/outbox` avec simulateurs ; garde anti-console en production.
- [ ] Historique filtrable avec coûts et export.

## 14. Évolutions du modèle de données

```prisma
model Message {
  // … champs existants de 02 …
  idempotencyKey     String?                  // unique par organisation
  kind               MessageKind @default(REMINDER)
  templateKey        String?
  whatsappTemplateName String?                // modèle Meta réellement utilisé
  intent             String?                  // classement M17 (entrants)
  intentConfidence   Float?
  attemptCount       Int      @default(0)
  nextRetryAt        DateTime?
  failedAt           DateTime?
  @@unique([organizationId, idempotencyKey, channel])
  @@index([organizationId, customerId, createdAt])
  @@index([organizationId, status, createdAt])
}
enum MessageKind { REMINDER TRANSACTIONAL CONVERSATION DIGEST SYSTEM }

model MessageAttempt {
  id             String   @id @default(cuid())
  organizationId String
  messageId      String
  attempt        Int
  startedAt      DateTime
  finishedAt     DateTime?
  outcome        String                       // OK | TEMPORARY | PERMANENT_RECIPIENT | PERMANENT_TEMPLATE | PERMANENT_CONFIG | RATE_LIMIT
  providerCode   String?
  providerRaw    Json?
}

model MessageStatusEvent {                    // idempotence des webhooks de statut
  id                String   @id @default(cuid())
  organizationId    String
  providerMessageId String
  status            MessageStatus
  occurredAt        DateTime
  @@unique([providerMessageId, status])
}

model Conversation {
  // …
  whatsappWindowExpiresAt DateTime?
  lastInboundAt      DateTime?
  candidateCustomerIds String[]               // numéro partagé, à trancher
  createdAt          DateTime @default(now())
}

model MessageTemplate {
  // …
  type               ReminderType?            // classement dans l'éditeur
  isTransactional    Boolean  @default(false)
  whatsappCategory   String?                  // UTILITY | MARKETING | AUTHENTICATION (effective)
  whatsappParamMap   Json?                    // ["client.salutation","vehicule.marque",…]
  whatsappRejectedReason String?
  whatsappVersion    Int      @default(1)
  isDefault          Boolean  @default(true)  // modèle livré non modifié
  updatedAt          DateTime @updatedAt
}

model QuickReply {
  id             String   @id @default(cuid())
  organizationId String
  title          String
  shortcut       String                       // "/prix-vidange"
  body           String
  templateKey    String?                      // modèle approuvé équivalent (hors fenêtre 24 h)
  createdById    String?
  @@unique([organizationId, shortcut])
}

model ChannelConfig {
  // …
  webhookVerifyToken String?
  messagingTier      String?                  // palier de messagerie WhatsApp
  lastError          String?
}

model Customer {
  // …
  hasWhatsappCheckedAt DateTime?
  emailInvalidAt       DateTime?
}

model OptOut {
  // …
  source         String?                      // keyword | email_link | staff | complaint
  messageId      String?
}
```
