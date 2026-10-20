# M17 — Intelligence (IA) et automatisations

> Priorité : P1 (la correspondance de colonnes M13 et la classification d'intention M11 sont livrées dès leurs modules, en P0, avec dégradation gracieuse) · Dépend de : M01, M02, M03, M05, M08, M09, M10, M11, M12, M13, M15 · Rôles concernés : tous les rôles internes (selon fonction), OWNER (configuration)

## 1. Objectif

Faire travailler l'outil **à la place** de l'équipe sur les tâches répétitives, sans jamais lui retirer la décision : l'IA **propose** (brouillon de réponse, créneau, devis, colonne d'import, données extraites d'une photo, moment de relance, alerte d'anomalie), l'humain **valide** toute action qui a un effet (envoi d'un message, prix, paiement, écriture en base hors suggestions). Le module fournit aussi un assistant conversationnel en lecture seule pour le gérant, et un moteur d'**automatisations sans IA** (« si… alors… ») configurable. Toutes les fonctions passent par un unique service `packages/integrations/ai` (API Claude), journalisé, plafonné par plan, multi-locataire, et dégradable.

## 2. Utilisateurs et cas d'usage

| Rôle                     | Ce qu'il fait avec M17                                                                                             | Fréquence         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| ADVISOR                  | Accepte/modifie les brouillons de réponse, les créneaux proposés, les devis pré-rédigés, les explications de devis | Continu           |
| MANAGER                  | Pré-devis depuis l'inspection, anomalies atelier/stock                                                             | Quotidien         |
| STOREKEEPER / ACCOUNTANT | Extraction de factures fournisseurs (photo → bon de réception)                                                     | Hebdomadaire      |
| OWNER                    | Assistant conversationnel, résumé intelligent, anomalies, configuration, consommation                              | Quotidien         |
| CASHIER / ACCOUNTANT     | Score de risque de non-paiement, anomalies de caisse                                                               | Quotidien         |
| Système                  | Prédiction kilométrage/révision, meilleur moment de relance, automatisations                                       | Tâches planifiées |

## 3. User stories

**US-M17-01 — En tant que réceptionniste, je veux que chaque message entrant soit classé et accompagné d'un brouillon de réponse.**

- Étant donné le message WhatsApp de M. Kouassi « oui ok pour samedi matin svp » en réponse à une relance VT, quand il arrive (`message.inbound_received`), alors dans les 10 s `Conversation.lastIntent = "BOOK_APPOINTMENT"` (badge « Veut un RDV »), et la boîte de réception affiche un brouillon « Bonjour M. Kouassi, nous vous proposons samedi 24/10 à 08:30 pour la pré-visite de votre Toyota Corolla (2547 GH 01). Cela vous convient ? » avec les boutons « Envoyer », « Modifier », « Ignorer ».
- Étant donné que je clique « Envoyer » sans modifier, alors `AiInteraction.accepted = true`, `editDistance = 0` ; si je modifie, `accepted = true` et `editDistance` > 0 ; si j'ignore, `accepted = false`. **Rien** n'est envoyé sans clic.

**US-M17-02 — En tant que réceptionniste, je veux une proposition de créneau.**

- Étant donné l'intention `BOOK_APPOINTMENT` avec « samedi matin », quand l'IA extrait `{ day: "2026-10-24", period: "MORNING", type: "INSPECTION_PREP" }`, alors le système (sans IA) appelle `appointments.availableSlots` et propose les 3 premiers créneaux libres correspondants ; « Réserver 08:30 » crée le RDV (`source = WHATSAPP`, `reminderId` de la relance d'origine) après mon clic.

**US-M17-03 — En tant que chef d'atelier, je veux un devis pré-rédigé à partir des doléances et de l'inspection.**

- Étant donné l'OR OR-YOP-2026-00042 (doléance « bruit au freinage » ; inspection : plaquettes avant URGENT 2 mm, disques avant WATCH, vidange dépassée de 1 200 km), quand je clique « Proposer un devis », alors un brouillon de devis apparaît avec des lignes **issues uniquement du catalogue** (`LaborOperation` et `Product` de l'organisation, compatibles Toyota Corolla 2018 si l'info existe) : « Remplacement plaquettes AV » 0,8 h, « Plaquettes AV Corolla 2014-2019 » ×1, « Vidange + filtre » 0,5 h, « Huile 5W30 » ×4 L, « Filtre à huile » ×1, disques en ligne optionnelle WATCH ; prix calculés par `core/money` (jamais par l'IA) ; chaque ligne affiche sa justification (« Inspection : plaquettes 2 mm »).
- Étant donné qu'aucune pièce du catalogue ne correspond à un besoin, alors une ligne « À chiffrer : disques avant (non trouvée au catalogue) » à prix 0 est ajoutée et le devis ne peut pas être envoyé tant qu'elle n'est pas complétée.

**US-M17-04 — En tant que réceptionniste, je veux expliquer le devis au client en langage simple.**

- Quand je clique « Générer l'explication », alors pour chaque groupe de lignes un texte de 2 phrases max est proposé (« Vos plaquettes de frein avant sont presque usées (2 mm). Les changer maintenant évite d'abîmer les disques et garantit un bon freinage. ») ; je peux éditer ; seule la version validée est affichée sur le portail (M14).

**US-M17-05 — En tant que gérant, je veux que l'import reconnaisse les colonnes que les synonymes ne connaissent pas.**

- Étant donné une colonne « Contact proprio » avec exemples `07XXXXXXXX`, quand M13 appelle `ai.mapColumns`, alors la proposition `customer.phone` (confiance 0,9) est affichée en orange à confirmer.

**US-M17-06 — En tant que réceptionniste, je veux photographier une carte grise pour créer le véhicule.**

- Étant donné une photo de carte grise ivoirienne, quand je la dépose dans « Nouveau véhicule », alors les champs plaque, marque, modèle/type, VIN, date de 1re mise en circulation, énergie, nom du titulaire sont pré-remplis avec un indicateur de confiance par champ ; les champs < 0,7 sont surlignés « À vérifier » ; rien n'est enregistré avant « Créer ».
- Étant donné une photo de vignette de visite technique, alors la date de validité est proposée pour `inspectionExpiryDate` ; étant donné une facture fournisseur, alors un brouillon de réception (M07) avec lignes rapprochées des `Product` (par référence OEM, SKU ou nom) est proposé.

**US-M17-07 — En tant que gérant, je veux connaître le kilométrage estimé et la prochaine révision de chaque véhicule.**

- Étant donné 3 relevés (12 000 km le 10/01/2026, 18 500 km le 15/05/2026, 24 100 km le 02/10/2026), alors `avgKmPerDay` ≈ 45,5 et, calculée le 02/10/2026, la prochaine révision (intervalle 10 000 km, dernière à 20 000 km le 01/07/2026, intervalle temps 12 mois) est prévue à 30 000 km : 5 900 km restants ÷ 45,5 = 130 j → `nextServiceDueDate = 09/02/2027` (antérieure au 01/07/2027 par le temps) (RG-M17-14).

**US-M17-08 — En tant que comptable, je veux un score de risque de non-paiement.**

- Étant donné un client avec 3 factures payées en moyenne à J+42 et 1 promesse non tenue, alors `Customer.riskScore = 72` (« Risque élevé ») avec les 3 facteurs principaux affichés ; à la création d'un OR pour ce client avec encours > 0, un bandeau propose « Demander un acompte ».

**US-M17-09 — En tant que gérant, je veux que les relances partent au meilleur moment et sur le meilleur canal.**

- Étant donné que Koné Ibrahim a lu 4 de ses 5 derniers messages WhatsApp entre 19 h et 21 h et n'a jamais lu de SMS, alors sa prochaine relance créance planifiée à 09:00 est décalée à 19:00 (dans la fenêtre d'envoi autorisée) sur WhatsApp, avec la mention « Heure optimisée » dans la file « Relances du jour ».

**US-M17-10 — En tant que gérant, je veux poser des questions à l'application.**

- Étant donné l'assistant ouvert sur mon téléphone, quand je demande « combien me doit SOTRA ? », alors la réponse est « SOTRA Logistique SARL vous doit 1 240 000 FCFA sur 3 factures ; la plus ancienne (FAC-2026-000287, 610 000 FCFA) a 38 jours de retard. Dernière relance le 15/10. » avec liens vers la fiche et les factures.
- Quand je demande « quels véhicules ont leur VT ce mois ? », alors j'obtiens la liste (nombre + 10 premiers + « Voir les 41 » vers `/echeances?type=vt&periode=mois`).
- Étant donné qu'un ADVISOR sans `report:financial` demande « quel est mon CA ce mois ? », alors l'assistant répond « Vous n'avez pas accès à cette information. »

**US-M17-11 — En tant que gérant, je veux être prévenu des anomalies.**

- Étant donné une facture émise avec une remise de 35 % alors que la remise moyenne du conseiller est de 4 %, alors une alerte `anomaly.discount` « Remise inhabituelle : 35 % sur FAC-2026-000455 (Koffi A.) » est créée pour l'OWNER.

**US-M17-12 — En tant que gérant, je veux automatiser des actions simples sans IA.**

- Étant donné la règle « Quand un OR passe à Prêt → envoyer le modèle "Véhicule prêt" avec lien de paiement au client », quand l'OR OR-YOP-2026-00042 passe `READY`, alors le message est mis en file (M11) et l'exécution est journalisée ; si la règle est en mode « Proposer », il apparaît dans « Relances du jour » en attente de validation.

## 4. Règles métier

### 4.1 Service IA et garde-fous

- **RG-M17-01 — Service unique.** `packages/integrations/ai` expose `AiProvider` :
  ```ts
  interface AiProvider {
    complete<T>(req: {
      feature: AiFeature;
      promptVersion: string;
      system: string;
      messages: AiMessage[];
      schema?: ZodSchema<T>;
      tools?: AiTool[];
      images?: AiImage[];
      maxTokens: number;
      timeoutMs: number;
      ctx: TenantContext;
    }): Promise<{ output: T; tokensIn: number; tokensOut: number; latencyMs: number }>;
  }
  ```
  Implémentations : `claude` (API Anthropic, modèle lu dans `AI_MODEL`, modèle léger optionnel `AI_MODEL_FAST` pour classification/extraction courte) et `console` (réponses déterministes de fixtures pour local/tests). Aucune autre partie du code n'appelle l'API directement. Sorties structurées **validées par Zod** ; sortie invalide → 1 nouvel essai avec message d'erreur de validation, puis échec propre.
- **RG-M17-02 — L'IA propose, l'humain valide.** Aucune fonction IA n'envoie de message, ne fixe un prix, ne crée de paiement, ne modifie un client/véhicule/facture. Elles produisent des **suggestions** (`AiSuggestion`, §14) que l'utilisateur accepte (l'action est alors exécutée par la procédure métier normale, avec ses permissions et son audit, `AuditLog.after.aiSuggestionId`). Exceptions **sans effet externe** autorisées automatiquement : `Conversation.lastIntent`, `Customer.riskScore`, `Vehicle.avgKmPerDay/estimatedMileage` (calculs déterministes), décalage horaire d'une relance dans sa fenêtre (désactivable).
- **RG-M17-03 — Multi-locataire.** Le contexte envoyé au modèle ne contient que des données de l'organisation courante, chargées via `db.forTenant(ctx)`. Aucun cache de prompts/réponses partagé entre organisations. Les outils de l'assistant (RG-M17-20) s'exécutent avec le `ctx` de l'utilisateur (organisation, sites, permissions).
- **RG-M17-04 — Minimisation des données personnelles.** Avant envoi : remplacement des téléphones et emails par des jetons (`[TEL_1]`, `[EMAIL_1]`) ré-injectés après réponse (`core/ai/redact.ts`) ; pas de NCC, adresse, montant de solde sauf si nécessaire à la fonction (assistant, résumé) ; images envoyées sans métadonnées EXIF. Le fournisseur est configuré **sans conservation des données pour l'entraînement** (paramètres de compte API) ; mention dans la politique de confidentialité (ARTCI).
- **RG-M17-05 — Prompts versionnés.** Chaque fonction a ses prompts dans `packages/integrations/ai/prompts/{feature}/v{n}.ts` (système + exemples + schéma) ; `promptVersion` stocké dans `AiInteraction`. Changement de prompt = nouvelle version + jeu d'évaluation (`prompts/{feature}/eval.jsonl`, ≥ 20 cas) passé en CI (`pnpm ai:eval`, seuil d'exactitude par fonction : classification ≥ 90 %, mapping ≥ 90 %, extraction carte grise ≥ 85 % par champ).
- **RG-M17-06 — Journal.** Chaque appel crée un `AiInteraction` : `feature`, `promptVersion`, `inputRef` (ex. `message:msg_123`), `output`, `tokensIn/Out`, `latencyMs`, `status` (OK, INVALID_OUTPUT, TIMEOUT, ERROR, QUOTA_EXCEEDED, DISABLED), `credits`, `createdById`. `accepted` et `editDistance` mis à jour quand l'utilisateur agit. Les entrées brutes ne sont **pas** stockées (seulement `inputRef`) ; les sorties sont purgées après 180 jours (champ `output` vidé, métadonnées conservées).
- **RG-M17-07 — Coût et quotas.** Crédits consommés = `ceil((tokensIn + 4 × tokensOut) / 1 000)` (min. 1 par appel), compteur `UsageCounter` `ai_credits` (M15) ; quotas par plan (M15 RG-M15-19 : 500 / 3 000 / 10 000). Plafond par utilisateur et par jour : 200 crédits (assistant). À 100 % : fonctions **à la demande** désactivées (« Quota IA du mois atteint »), fonctions **de fond** (classification, prédictions déterministes) poursuivies en mode dégradé sans IA. Fonctions autorisées par plan : STARTER = classification, brouillon de réponse, mapping import, extraction photo, explication devis ; PRO/NETWORK = toutes.
- **RG-M17-08 — Dégradation gracieuse.** Timeout par fonction (classification 8 s, brouillon 15 s, devis 30 s, extraction 30 s, assistant 45 s) ; disjoncteur : 5 erreurs en 1 min → fonctions IA marquées « indisponibles » 5 min (bandeau discret « Assistant momentanément indisponible ») ; chaque fonction a un **repli** :

| Fonction                   | Repli sans IA                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Classification d'intention | Règles par mots-clés (`core/ai/fallback-intents.ts` : « stop », « payé », « rdv », « combien », « prix »…) |
| Brouillon de réponse       | Modèles de réponses rapides (M11)                                                                          |
| Suggestion de créneau      | 3 premiers créneaux libres, type déduit de la relance d'origine                                            |
| Pré-devis                  | Lignes recommandées des `InspectionItem` (`recommendedProductIds/LaborIds`)                                |
| Mapping de colonnes        | Synonymes seuls (M13)                                                                                      |
| Extraction photo           | Saisie manuelle                                                                                            |
| Résumé quotidien           | Résumé chiffré M12 sans phrase                                                                             |
| Assistant                  | Message « indisponible » + liens vers rapports                                                             |

- **RG-M17-09 — Prompt injection.** Le contenu client (messages entrants, textes de factures fournisseurs, en-têtes de fichiers) est placé dans des balises de données (`<message_client>…</message_client>`) avec consigne système de ne jamais suivre d'instruction qui s'y trouve. Les sorties ne peuvent déclencher que des suggestions validées par schéma ; l'assistant n'a que des outils en lecture.
- **RG-M17-10 — Activation.** `settings.ai = { enabled: true, features: { [feature]: boolean }, autoTimeOptimization: true, assistantEnabled: true }` ; l'OWNER peut tout désactiver. Langue de sortie : français (ivoirien courant, vouvoiement, sans jargon) ; montants formatés par le code, jamais par le modèle.

### 4.2 Fonctions

- **RG-M17-11 — Classification d'intention** (`intent_classification`, modèle rapide). Entrée : 5 derniers messages de la conversation, type et palier de la dernière relance, véhicule concerné. Sortie Zod : `{ intent, confidence, entities: { date?, period?: MORNING|AFTERNOON|EVENING, amount?, promisedDate?, vehiclePlate? }, sentiment: POSITIVE|NEUTRAL|NEGATIVE, needsHuman: boolean }`. Intentions : `BOOK_APPOINTMENT`, `RESCHEDULE`, `CANCEL_APPOINTMENT`, `CONFIRM`, `PAYMENT_DONE`, `PAYMENT_PROMISE`, `ASK_PRICE`, `ASK_STATUS`, `ASK_BALANCE`, `COMPLAINT`, `OPT_OUT`, `THANKS`, `OTHER`. Effets : `OPT_OUT` avec confiance ≥ 0,9 → **suggestion** de désinscription (le mot-clé exact « STOP » reste traité par M11 sans IA) ; `PAYMENT_PROMISE` → suggestion de `PaymentPromise` pré-remplie (M09) ; `PAYMENT_DONE` → tâche « Vérifier le paiement annoncé » pour le caissier ; `COMPLAINT` ou `NEGATIVE` → conversation priorisée et assignée au MANAGER ; `Reminder.outcome = REPLIED` sur la relance liée (M10).
- **RG-M17-12 — Brouillon de réponse** (`reply_draft`) : contexte = conversation, client (civilité, nom), véhicules, solde dû, RDV à venir, horaires du site, liens disponibles (`{{lien.paiement}}`…) ; contrainte ≤ 600 caractères WhatsApp / 160 SMS ; ne promet jamais un prix ni une date non issus des données ; insère les liens via variables résolues par le code.
- **RG-M17-13 — Pré-devis** (`quote_draft`) : entrée = doléance, diagnostic, `InspectionItem` (WATCH/URGENT), véhicule (marque, modèle, année, km), **liste candidate** du catalogue présélectionnée par le code (recherche trigram/compatibilité sur `Product.name`, `compatibleWith`, `category`, et `LaborOperation`, ≤ 80 entrées). Sortie : `[{ kind: LABOR|PART, catalogId | null, quantity, reason, priority: URGENT|WATCH|null, optional }]`. Le code rejette tout `catalogId` absent de la liste candidate, calcule prix/TVA/remises (`core/money`, taux M15, `Customer.discountRate`) et crée un `Quote` `DRAFT` uniquement sur clic « Créer le brouillon ». Quantités MO = `LaborOperation.standardHours` (l'IA ne choisit pas les temps).
- **RG-M17-14 — Kilométrage et révision** (déterministe, sans appel IA ; tâche `vehicles.estimate_mileage`) : `avgKmPerDay` = régression linéaire pondérée (poids ×2 pour les relevés < 12 mois) sur les relevés des 24 derniers mois (≥ 2 relevés espacés ≥ 30 jours) ; relevé aberrant (km décroissant ou > 500 km/jour) exclu ; à défaut, médiane de la flotte de l'organisation par `VehicleUsage` (M02) ou 40 km/j. `estimatedMileage = currentMileage + avgKmPerDay × jours depuis currentMileageAt`. Révision : `dateParKm = aujourd'hui + (lastServiceMileage + serviceIntervalKm − estimatedMileage) / avgKmPerDay` ; `dateParTemps = lastServiceDate + serviceIntervalMonths` ; `nextServiceDueDate = min(dateParKm, dateParTemps)` ; `nextServiceDueMileage = lastServiceMileage + serviceIntervalKm`. Émet `vehicle.mileage_recorded` (`payload.estimated = true`) seulement si la date change de > 3 jours. _Exemple US-M17-07_ : points (j0 ; 12 000), (j125 ; 18 500), (j265 ; 24 100), tous < 12 mois donc même poids → pente des moindres carrés = 1 601 000 / 35 150 ≈ 45,5 km/j ; reste 5 900 km → 130 j.
- **RG-M17-15 — Score de risque de non-paiement** (déterministe, `core/receivables/risk.ts`, recalculé par `receivables.age`) : score 0-100 = somme plafonnée de : retard moyen de paiement 12 mois (0 j → 0 ; ≥ 60 j → 30 pts, linéaire) ; part des factures payées après échéance (× 20 pts) ; promesses non tenues (10 pts chacune, max 20) ; encours / plafond de crédit (> 100 % → 15 pts) ; ancienneté du plus vieux solde (> 90 j → 15 pts) ; client nouveau (< 2 factures) → base 20. Niveaux : 0-29 Faible, 30-59 Moyen, 60-100 Élevé. Les 3 facteurs les plus contributifs sont stockés (`Customer.riskFactors`, §14). L'IA n'intervient pas dans le score (explicabilité).
- **RG-M17-16 — Meilleur moment / canal** (`send_time_optimization`, déterministe + statistiques) : pour chaque client, à partir des `Message` OUTBOUND des 12 derniers mois et des `Reminder.outcome` : taux de lecture par canal et par créneau de 2 h ; si ≥ 5 messages et un créneau a un taux de lecture ≥ 1,5 × la moyenne du client → créneau préféré ; canal préféré = canal au meilleur taux `(READ ou outcome positif)` avec ≥ 3 envois. Au niveau organisation (≥ 200 relances avec outcome), la tâche hebdomadaire `ai.learn_reminder_timing` calcule le taux de succès (`APPOINTMENT_BOOKED`, `PAID`, `PARTIALLY_PAID`, `PROMISED`) par `type × palier × jour de semaine × créneau × canal` et propose au gérant (suggestion, jamais automatique) des ajustements de règles M10 (« Les relances créance du lundi 18-20 h obtiennent 2× plus de paiements : décaler l'heure d'envoi ? »). Le décalage par client reste dans la `sendWindow` de la règle, ne retarde jamais de plus de 12 h, ne s'applique pas aux messages transactionnels et respecte `Customer.preferredChannel` s'il est renseigné manuellement.
- **RG-M17-17 — Mapping de colonnes** (`column_mapping`) : voir M13 RG-M13-07 ; sortie `[{ column, field | null, confidence }]` limitée aux champs du schéma cible fourni.
- **RG-M17-18 — Extraction de documents** (`document_extraction`, vision) : types `VEHICLE_REGISTRATION` (carte grise), `INSPECTION_STICKER` (vignette/certificat VT), `SUPPLIER_INVOICE`, `ODOMETER` (photo du compteur → km). Image redimensionnée 1 600 px, EXIF supprimé, ≤ 5 Mo ; sortie avec `confidence` par champ ; normalisation par le code (plaque RG-M13-13, dates RG-M13-11, montants RG-M13-12). Pour `SUPPLIER_INVOICE`, rapprochement des lignes par `oemReference` → `sku` → similarité de nom ≥ 0,6 ; contrôle `Σ lignes = total` (écart signalé).
- **RG-M17-19 — Explication de devis** (`quote_explanation`) : ≤ 2 phrases par groupe, niveau collège, sans prix ni promesse de garantie ; stockée dans `Quote` (§14 `customerExplanation`) seulement après validation.
- **RG-M17-20 — Assistant conversationnel** (`assistant`) : boucle d'outils (tool use) **lecture seule**, max 6 appels d'outils par question, réponses avec liens profonds. Outils (chacun = fonction serveur qui vérifie la permission indiquée et le filtre de sites) :

| Outil                                                      | Permission                                        | Retour                                                        |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `search_customers({ query })`                              | `customer:read`                                   | ≤ 10 clients (id, nom, type, solde)                           |
| `get_customer_balance({ customerId })`                     | `receivable:read`                                 | solde, factures ouvertes, retard, dernière relance, promesses |
| `list_receivables({ minDaysOverdue?, minAmount?, limit })` | `receivable:read`                                 | factures ouvertes triées                                      |
| `list_vehicle_due_dates({ kind: VT\|SERVICE, from, to })`  | `vehicle:read`                                    | véhicules et échéances                                        |
| `get_kpi({ metric, period, siteId? })`                     | selon M12 §10 (`report:financial` pour CA/marges) | valeur M12 `dashboard.kpi` (mêmes formules)                   |
| `list_repair_orders({ status?, siteId? })`                 | `repair_order:read`                               | OR                                                            |
| `list_appointments({ date })`                              | `appointment:read`                                | RDV                                                           |
| `get_stock({ query })`                                     | `stock:read`                                      | niveaux par site (coûts seulement si `product:view_cost`)     |
| `list_reminders({ status, type? })`                        | `reminder:read`                                   | relances                                                      |

Les chiffres cités proviennent **exclusivement** des retours d'outils (consigne + vérification : tout nombre de la réponse doit apparaître dans un résultat d'outil, sinon la réponse est remplacée par les données brutes formatées). Historique de conversation conservé 30 jours (`AiAssistantThread`, §14). Une question demandant une action (« relance SOTRA ») → l'assistant répond avec un **bouton d'action** vers l'écran concerné (pré-rempli), sans exécuter.

- **RG-M17-21 — Résumé quotidien intelligent** (`daily_digest`) : entrée = les chiffres calculés par M12 (RG-M12-30) et la liste des alertes ; sortie = **une** phrase « faits marquants » ≤ 200 caractères (« Hier, record d'encaissement Wave ; attention, 3 véhicules prêts depuis plus de 3 jours. ») ; le résumé n'est jamais bloqué par l'IA (repli : sans phrase).
- **RG-M17-22 — Détection d'anomalies** (tâche `ai.anomalies`, quotidienne 06:00, statistiques déterministes ; l'IA rédige seulement le libellé si disponible) :

| Code                       | Règle                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `anomaly.discount`         | Remise de ligne ou de document > max(15 %, moyenne 90 j du conseiller + 3 écarts-types)                  |
| `anomaly.cash_gap`         | Écarts de caisse cumulés d'un même caissier < −20 000 FCFA sur 30 j, ou 3 écarts négatifs consécutifs    |
| `anomaly.stock_shrink`     | Écart d'inventaire valorisé > 50 000 FCFA sur un produit, ou sorties `ADJUSTMENT` négatives > 3 sur 30 j |
| `anomaly.part_not_billed`  | Pièce sortie vers un OR (`ISSUE_TO_RO`) mais absente de la facture de cet OR                             |
| `anomaly.price_below_cost` | Ligne facturée avec `unitPrice < averageCost`                                                            |
| `anomaly.void_spike`       | > 3 factures annulées/avoirs par un même utilisateur sur 7 j                                             |
| `anomaly.time_overrun`     | Heures pointées > 2 × heures vendues sur un OR facturé                                                   |

Chaque anomalie → `Notification` OWNER (`severity = warning`), dédoublonnée par objet ; « Marquer comme justifiée » avec commentaire (audit).

### 4.3 Automatisations sans IA

- **RG-M17-23 — Règles « si… alors… »** (`AutomationRule`, §14) : **déclencheur** = un événement de domaine (01 §5 + `repair_order.status_changed` avec filtre de statut, `quote.viewed`, `invoice.issued`, `payment.received`, `appointment.no_show`, `customer.created`, `portal.feedback_received`) ; **conditions** = liste `{ field, op: eq|neq|gt|gte|lt|lte|in|contains, value }` sur le payload enrichi (ex. `repairOrder.status eq READY`, `customer.type eq COMPANY`, `invoice.balance gt 0`, `site.code eq YOP`) combinées en ET ; **actions** : `send_template` (modèle M11 + canal, avec `{{lien.*}}`), `create_payment_link`, `notify_members` (rôles ou membres), `assign_conversation`, `add_customer_tag`, `create_task` (`Notification` avec lien), `schedule_reminder` (crée un `Reminder` de type CUSTOM à J+n), `call_webhook` (endpoint M13). **Mode** : `AUTO` (exécution immédiate) ou `PROPOSE` (crée un `Reminder` `NEEDS_APPROVAL` ou une suggestion). Délai optionnel (`delayMinutes`, ex. 30 min après `READY`).
- **RG-M17-24 — Exécution** : file `automations` ; idempotence par `(ruleId, eventId)` ; garde anti-boucle (une règle ne peut pas être déclenchée par un événement qu'elle a elle-même produit, profondeur max 3) ; les actions d'envoi passent par M11 avec OptOut, consentement, fenêtre d'envoi et quotas (M15) ; chaque exécution → `AutomationRun` (statut, actions effectuées, erreur). Les relances M10 restent le mécanisme des séquences (VT, révision, créances) ; les automatisations couvrent les réactions ponctuelles.
- **RG-M17-25 — Modèles fournis** (désactivés par défaut, activables en un clic) : « OR prêt → message + lien de paiement » ; « Devis consulté sans réponse depuis 24 h → notifier le conseiller » ; « Paiement reçu → reçu par WhatsApp » ; « RDV non honoré → message de reprogrammation » ; « Avis ≤ 3 → tâche gérant » ; « Nouveau client entreprise → tag _flotte_ + notifier le comptable ».

## 5. Machine à états

`AiSuggestion.status` : `PENDING → ACCEPTED | EDITED_ACCEPTED | DISMISSED | EXPIRED` (48 h, ou contexte périmé : nouveau message, devis modifié). `AutomationRule` : `isActive` on/off. `AutomationRun.status` : `PENDING → SUCCEEDED | FAILED | SKIPPED` (conditions non remplies au moment de l'exécution différée) ; `FAILED` réessayé 3 fois.

## 6. Données

`AiInteraction` (+ compléments §14), `Conversation.lastIntent`, `Message`, `Reminder` (`scheduledFor`, `channel`, `outcome`), `Customer.riskScore`, `Vehicle` (`avgKmPerDay`, `estimatedMileage`, `nextServiceDueDate`, `nextServiceDueMileage`), `MileageReading`, `Quote`/`QuoteLine`, `Product`, `LaborOperation`, `Inspection`/`InspectionItem`, `Attachment`, `Notification`, `UsageCounter` (M15). Nouveaux : `AiSuggestion`, `AiAssistantThread`, `AiAssistantMessage`, `AutomationRule`, `AutomationRun`.

## 7. Écrans et interface

- **Boîte de réception** (`/messages`, M11) : badge d'intention (icône + texte), carte « Suggestion » sous le dernier message entrant (brouillon, créneaux, promesse détectée) avec Envoyer / Modifier / Ignorer ; mention « Proposé par l'assistant ».
- **OR / devis** (`/ordres/[id]`, `/devis/[id]`) : bouton « Proposer un devis » ; panneau latéral de lignes proposées avec justification et case à cocher par ligne ; « Générer l'explication client ».
- **Formulaires véhicule / réception de commande** : zone « Photographier un document » (caméra sur mobile) ; champs pré-remplis surlignés, indicateur de confiance.
- **Fiche client** : jauge de risque (Faible / Moyen / Élevé + facteurs).
- **Relances du jour** (M10) : mention « Heure optimisée 19:00 » avec info-bulle.
- **Assistant** : bouton flottant (icône étincelle + « Assistant ») sur tableau de bord et en plein écran `/assistant` sur mobile ; suggestions de questions (« Qui me doit le plus ? », « VT de la semaine », « CA d'hier »), réponses avec tableaux compacts et liens ; saisie vocale via l'API du navigateur si disponible ; mention permanente « Lecture seule — l'assistant ne modifie rien ».
- **`/parametres/ia`** : interrupteurs par fonction, optimisation horaire, consommation du mois (jauge crédits, top fonctions, taux d'acceptation par fonction), journal des 100 derniers appels (fonction, date, statut, crédits, accepté).
- **`/parametres/automatisations`** : liste des règles (nom, déclencheur, mode, actif, dernière exécution) ; éditeur « Quand… / Si… / Alors… » en 3 blocs avec listes déroulantes ; « Tester sur un exemple » (choisir un OR/une facture existant → simulation sans envoi) ; historique des exécutions.

États : bouton IA désactivé avec info-bulle si quota atteint, fonction désactivée ou service indisponible ; squelette pendant la génération (« L'assistant prépare une proposition… ») avec annulation.

## 8. API

| Procédure tRPC                                     | Entrée                                                              | Sortie                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ai.classifyMessage` (interne, worker)             | `{ messageId }`                                                     | `{ intent, confidence, entities }`                                     |
| `ai.suggestReply`                                  | `{ conversationId }`                                                | `AiSuggestion` (`{ body, slots?, promise? }`)                          |
| `ai.suggestSlots`                                  | `{ conversationId \| customerId, type?, preferences? }`             | `{ slots[] }`                                                          |
| `ai.draftQuote`                                    | `{ repairOrderId }`                                                 | `AiSuggestion` (`{ lines: [...], unmatched: [...] }`)                  |
| `ai.explainQuote`                                  | `{ quoteId }`                                                       | `AiSuggestion` (`{ groups: [{ key, text }] }`)                         |
| `ai.mapColumns`                                    | `{ importJobId, columns: [{ header, samples[] }], targetFields[] }` | `{ mappings[] }`                                                       |
| `ai.extractDocument`                               | `{ uploadId, kind }`                                                | `AiSuggestion` (`{ fields: { name: { value, confidence } }, lines? }`) |
| `ai.suggestion.accept`                             | `{ suggestionId, editedPayload? }`                                  | résultat de l'action métier appelée                                    |
| `ai.suggestion.dismiss`                            | `{ suggestionId, reason? }`                                         | `{ ok }`                                                               |
| `ai.assistant.ask`                                 | `{ threadId?, question }`                                           | flux (streaming) `{ text, links[], toolCalls[] }`                      |
| `ai.assistant.threads` / `thread` / `deleteThread` | …                                                                   | …                                                                      |
| `ai.usage`                                         | `{ period }`                                                        | `{ credits, byFeature, acceptanceRate }`                               |
| `ai.interactions.list`                             | `{ cursor, feature? }`                                              | journal                                                                |
| `customers.riskScore`                              | `{ customerId }`                                                    | `{ score, level, factors }`                                            |
| `automations.list/get/create/update/toggle/delete` | `AutomationRuleInput`                                               | `AutomationRule`                                                       |
| `automations.test`                                 | `{ ruleId, sampleEntity: { type, id } }`                            | `{ matched, actions: [{ type, preview }] }`                            |
| `automations.runs`                                 | `{ ruleId?, cursor }`                                               | `AutomationRun[]`                                                      |

`ai.suggestion.accept` dispatche vers la procédure métier (`messages.send`, `appointments.create`, `quotes.createFromDraft`, `vehicles.create`, `purchase.receiveDraft`, `promises.create`…) en vérifiant **ses** permissions. Pas d'endpoint REST public pour M17 en v1.

## 9. Automatisations et événements

- Consommés : `message.inbound_received` (classification + brouillon si `settings.ai.features.reply_draft`), `vehicle.mileage_recorded` (recalcul), `payment.received` / `promise.broken` (score de risque), `invoice.issued` (anomalies remise/prix), `cash_session.closed`, tous les événements déclencheurs d'`AutomationRule`.
- Tâches : `vehicles.estimate_mileage` (02:00, 01 §6), `receivables.age` (01:00, calcule `riskScore`), `ai.learn_reminder_timing` (hebdomadaire, dimanche 03:00), `ai.anomalies` (06:00), `ai.suggestions_expire` (horaire), `ai.purge_outputs` (quotidienne, > 180 j), `automations.dispatch` (file `automations`).
- Émis : `ai.suggestion_created`, `ai.anomaly_detected`, `automation.executed`.

## 10. Permissions

| Action                                              | Permission                                                                               | Rôles par défaut                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Utiliser les suggestions, l'extraction, l'assistant | `ai:use` (+ permission de l'action métier à l'acceptation, + permission de chaque outil) | Tous (M01)                                   |
| Pré-devis / explication                             | `ai:use` + `quote:create`                                                                | OWNER, MANAGER, ADVISOR                      |
| Voir le score de risque                             | `receivable:read`                                                                        | OWNER, MANAGER, ADVISOR, CASHIER, ACCOUNTANT |
| Configurer l'IA, voir consommation et journal       | `ai:configure`                                                                           | OWNER                                        |
| Créer/modifier des automatisations                  | `ai:configure` + `reminder:rules_manage`                                                 | OWNER                                        |
| Recevoir les anomalies                              | `dashboard:owner`                                                                        | OWNER                                        |

## 11. Cas limites et erreurs

- Message entrant en nouchi ou mélange français/dioula (« on dit quoi, ma voiture là c'est prêt ? ») → classification `ASK_STATUS` attendue (cas présents dans le jeu d'évaluation) ; confiance < 0,6 → `OTHER` + `needsHuman`.
- Message vocal WhatsApp → pas de transcription en v1 ; intention `OTHER`, badge « Message vocal ».
- Client qui écrit « STOP » dans une phrase (« stop je viens demain ») → M11 ne désinscrit que sur message égal à STOP/ARRET (insensible à la casse) ; l'IA classe `BOOK_APPOINTMENT`.
- Brouillon généré puis nouveau message du client avant envoi → suggestion `EXPIRED`, nouvelle suggestion générée.
- Pré-devis sur véhicule sans marque/modèle connus → candidats sans filtre de compatibilité, avertissement « Compatibilité non vérifiée ».
- Photo floue / document non reconnu → « Document illisible, reprenez la photo en pleine lumière » ; aucun champ pré-rempli à confiance < 0,4.
- Assistant interrogé sur un autre garage (« combien me doit X chez Garage Y ») → seules les données de l'organisation active sont accessibles ; réponse « Je ne trouve pas ce client ».
- Question hors périmètre (« écris-moi un poème ») → réponse courte de recentrage, crédits comptés.
- Automatisation `send_template` vers un client sans consentement ou en OptOut → `AutomationRun` `SKIPPED` avec motif ; messages transactionnels autorisés selon 02 §3.
- Deux règles d'automatisation envoyant un message pour le même événement → M11 dédoublonne par `(customerId, templateKey, eventId)` ; avertissement à la création de la seconde règle.

## 12. Tests

- **Unitaires** : `core/ai/redact` (masquage/réinjection), parsing Zod des sorties (fixtures valides/invalides), calcul des crédits, disjoncteur, replis par fonction ; RG-M17-14 (cas US-M17-07, relevés aberrants, un seul relevé, véhicule neuf) ; RG-M17-15 (barème complet, plafonds) ; RG-M17-16 (seuils 5 envois, 1,5×, fenêtre et 12 h) ; règles d'anomalies ; moteur d'automatisations (conditions, idempotence, anti-boucle, délai).
- **Intégration** (fournisseur `console`) : acceptation d'une suggestion appelle la procédure métier avec permissions (ADVISOR sans `invoice:void` ne peut rien obtenir de plus via l'IA) ; outils de l'assistant filtrés par site et permission ; isolation multi-locataire (prompt construit ne contient aucune donnée d'une autre organisation) ; quota atteint → `QUOTA_EXCEEDED` et repli ; `AiInteraction` créé pour chaque appel.
- **Évaluations IA** (`pnpm ai:eval`, hors CI bloquante sauf changement de prompt) : jeux par fonction avec seuils RG-M17-05.
- **E2E Playwright** : message entrant « oui samedi matin » → badge « Veut un RDV » → choisir le créneau proposé → RDV créé et relance VT arrêtée ; activer le modèle d'automatisation « OR prêt → message + lien » et passer un OR à Prêt → message visible dans `/dev/outbox`.

## 13. Définition de « terminé »

- [ ] Service `ai` unique avec `AI_MODEL`, implémentation `console`, Zod, timeouts, disjoncteur, journal `AiInteraction`.
- [ ] 12 fonctions livrées avec leur repli ; aucune action à effet sans clic humain.
- [ ] Minimisation PII et protection contre l'injection testées.
- [ ] Quotas par plan et page de consommation.
- [ ] Assistant lecture seule avec outils permissionnés et chiffres vérifiés.
- [ ] Moteur d'automatisations, éditeur, test à blanc, 6 modèles fournis.
- [ ] Prompts versionnés avec jeux d'évaluation passant les seuils.

> **Livraison étape 6.2 (20/10/2026)** — service `ai` unique (`packages/integrations/src/ai` : Claude via `@anthropic-ai/sdk`, modèle `AI_MODEL` par défaut `claude-opus-5-5`, `AI_MODEL_FAST` optionnel ; fournisseur `console` déterministe, utilisé par tous les tests ; `AI_PROVIDER` force l'un ou l'autre), Zod + 1 réessai, timeouts, disjoncteur, quotas par plan, journal `AiInteraction`, masquage PII et balisage anti-injection. Fonctions livrées : classification d'intention et brouillon de réponse (boîte de réception), créneaux proposés et réservation en un clic, pré-devis et explication client (portail), extraction de documents (carte grise, vignette VT, compteur, facture fournisseur, constat amiable), aide IA à la correspondance de colonnes M13, assistant lecture seule, anomalies, meilleur moment d'envoi, moteur d'automatisations. Écarts :
>
> - **RG-M17-14 / RG-M17-15 non réimplémentées** : le kilométrage estimé reste celui de M02 (RG-M02-09/10, déjà livré, paramètres différents) et le score de risque celui de M09 (barème à 5 composantes, déjà livré ; M09 : « M17 … jamais en remplacement »). `Customer.riskFactors/riskScoredAt` sont créés (§14) mais non alimentés.
> - **Quotas** : crédits comptés depuis `AiInteraction.credits` du mois (fuseau de l'organisation) ; `UsageCounter` (M15 §14) n'existe pas encore (étape 6.5).
> - **Sorties structurées** : schéma JSON (dérivé du Zod) placé dans le prompt système puis validation Zod côté code, plutôt que `output_config.format`, pour rester portable entre fournisseurs. Pas de repli serveur en cas de refus (`stop_reason = refusal` → repli sans IA).
> - **Intentions** : catalogue M17 retenu (M11 RG-M11-20 annoté). `ai.classifyMessage` n'est pas une procédure tRPC : la classification est appelée à la réception du message (attente bornée à 9 s, puis poursuite en arrière-plan). `PAYMENT_PROMISE` propose d'ouvrir la fiche client (pas de création directe de `PaymentPromise`).
> - **Extraction** : image envoyée en base64 redimensionnée côté navigateur (1 600 px, EXIF supprimé, ≤ 5 Mo) au lieu d'un `uploadId` ; photo non conservée en `Attachment` ; facture fournisseur non branchée sur l'écran de réception M07 ; conducteurs du constat extraits mais non enregistrés.
> - **Assistant** : pas de streaming (réponse en une fois). _Étape 6.2b : `get_kpi` passe sur `dashboard.kpi` (M12 §8, créé à cette occasion) : CA HT/TTC, marges (sous `report:financial`), panier moyen, encaissements, créances, récupéré par relances, acceptation des devis, avec comparaison ; prompt assistant v2._
> - **Résumé quotidien** (`daily_digest`) : _livré en 6.2b_ — ligne 💡 du résumé M12, rédigée à partir des seuls chiffres agrégés (alertes réduites à leur nombre, aucune donnée personnelle), rejetée si elle cite un chiffre absent des faits ou dépasse 200 caractères ; absente en offre STARTER, hors quota ou en panne. Non affichée dans l'aperçu `digest.preview` (pas d'appel IA à chaque consultation).
> - **Anomalies** : libellés déterministes (pas de reformulation IA) ; alertes `alert.anomaly.*` du tableau de bord et page `/tableau-de-bord/anomalies` (« Marquer comme justifiée » avec motif, audit).
> - **Meilleur moment** : décalage horaire par client appliqué à la planification (`reminders.plan`). _6.2b : le canal préféré (`Customer.preferredChannel` manuel, sinon `bestChannel` appris si `settings.ai.autoTimeOptimization`) est essayé en premier par M10, au plan comme à l'envoi, toujours soumis à OptOut / numéro fixe / non WhatsApp / canal actif (repli sur l'ordre de la règle)._ Propositions d'ajustement de règles au niveau organisation (≥ 200 relances) non livrées.
> - **Évaluations** : pas de jeux `prompts/{feature}/eval.jsonl` ni de commande `pnpm ai:eval` en v1 (les fixtures console sont testées unitairement).
> - **Schéma** : `AiAssistantMessage.organizationId` (RLS), `AutomationRule.activatedAt`, `AutomationRun.scheduledFor/attempts/executedAt` ajoutés ; suppression en cascade avec l'organisation pour les tables IA.

## 14. Évolutions du modèle de données

```prisma
// Compléments AiInteraction
//   promptVersion String
//   status        String   @default("OK")    // OK | INVALID_OUTPUT | TIMEOUT | ERROR | QUOTA_EXCEEDED | DISABLED
//   latencyMs     Int?
//   credits       Int      @default(0)
//   model         String?                     // valeur de AI_MODEL utilisée
//   editDistance  Int?
//   @@index([organizationId, feature, createdAt])

model AiSuggestion {
  id             String   @id @default(cuid())
  organizationId String
  interactionId  String?                      // AiInteraction (null si repli sans IA)
  feature        String                       // reply_draft | slot | quote_draft | quote_explanation | extraction | promise | optout | rule_tuning
  targetEntity   String                       // conversation | repair_order | quote | vehicle | purchase_order | reminder_rule
  targetId       String?
  payload        Json
  status         AiSuggestionStatus @default(PENDING)
  isFallback     Boolean  @default(false)
  decidedById    String?
  decidedAt      DateTime?
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  @@index([organizationId, targetEntity, targetId, status])
}
enum AiSuggestionStatus { PENDING ACCEPTED EDITED_ACCEPTED DISMISSED EXPIRED }

model AiAssistantThread {
  id             String   @id @default(cuid())
  organizationId String
  membershipId   String
  title          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  expiresAt      DateTime                     // +30 j
}

model AiAssistantMessage {
  id             String   @id @default(cuid())
  threadId       String
  role           String                       // user | assistant | tool
  content        Json
  interactionId  String?
  createdAt      DateTime @default(now())
}

model AutomationRule {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  trigger        String                       // "repair_order.status_changed"
  conditions     Json     @default("[]")      // [{ field, op, value }]
  actions        Json                         // [{ type:"send_template", templateKey:"vehicle_ready", channel:"WHATSAPP", withPaymentLink:true }]
  mode           AutomationMode @default(PROPOSE)
  delayMinutes   Int      @default(0)
  siteIds        String[]                     // vide = tous
  isActive       Boolean  @default(false)
  templateKey    String?                      // modèle fourni d'origine
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
enum AutomationMode { AUTO PROPOSE }

model AutomationRun {
  id             String   @id @default(cuid())
  organizationId String
  ruleId         String
  eventId        String
  status         String                       // PENDING | SUCCEEDED | FAILED | SKIPPED
  result         Json?
  error          String?
  depth          Int      @default(0)
  createdAt      DateTime @default(now())
  @@unique([ruleId, eventId])
}

// Ajouts à Customer
//   riskFactors   Json?                        // [{ code, points, label }]
//   riskScoredAt  DateTime?
//   bestSendHour  Int?                         // 0-23, heure locale optimale (RG-M17-16)
//   bestChannel   Channel?                     // canal appris (≠ preferredChannel manuel)

// Ajouts à Quote
//   customerExplanation Json?                  // { groupKey: texte validé } affiché sur le portail

// Ajouts à Reminder
//   timeOptimized Boolean @default(false)
//   originalScheduledFor DateTime?
```
