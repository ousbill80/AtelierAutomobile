# M15 — Paramètres et administration

> Priorité : P0 (partie 1, étape 1.2 : garage, sites, ponts, horaires, jours fériés, TVA, numérotation, mode) · P1 (partie 2, étape 6.5 : plans, export complet, suppression de compte, reste) · Dépend de : M01, M08, M10, M11, M13 · Rôles concernés : OWNER (principalement), MANAGER, ACCOUNTANT (lecture)

## 1. Objectif

Regrouper en un seul endroit, `/parametres`, tout ce qui configure le garage : identité légale et fiscale, sites, ponts, horaires, catalogue de main-d'œuvre, modèles d'inspection, numérotation, règles de relance, canaux de communication, paiement, FNE, PDF, intégrations, abonnement, données (export, suppression) et journal d'audit. Chaque paramètre a une valeur par défaut sûre pour qu'un garage d'Abidjan soit opérationnel en moins de 30 minutes. Les secrets sont chiffrés et jamais renvoyés au navigateur. Les écrans de M01 (utilisateurs, rôles), M10 (règles de relance) et M13 (import, sources) sont **hébergés** dans `/parametres` mais spécifiés dans leurs PRD.

## 2. Utilisateurs et cas d'usage

| Rôle                       | Ce qu'il fait                                                                                             | Fréquence          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| OWNER                      | Configure identité, TVA, canaux, paiements, FNE, plan ; exporte les données ; consulte l'audit            | Ponctuel / mensuel |
| MANAGER                    | Catalogue MO, modèles d'inspection (ponts, horaires et jours fériés si l'OWNER lui accorde `site:manage`) | Mensuel            |
| ACCOUNTANT                 | Consulte identité fiscale, numérotation, FNE ; consulte l'audit                                           | Ponctuel           |
| Équipe AtelierOS (support) | Change le plan sur demande, aide à la configuration (accès support tracé)                                 | Rare               |

## 3. User stories

**US-M15-01 — En tant que gérant, je veux renseigner l'identité légale de mon garage afin que devis et factures soient conformes.**

- Étant donné `/parametres/garage`, quand je saisis raison sociale « Garage Excellence Auto SARL », RCCM « CI-ABJ-2019-B-12345 », NCC « 1912345A », régime « RSI », adresse, téléphone, et téléverse un logo PNG, alors l'aperçu de l'en-tête de facture se met à jour en direct et l'enregistrement crée un `AuditLog` `org.update` avec avant/après.
- Étant donné un NCC au mauvais format, alors « Le NCC doit contenir 7 chiffres suivis d'une lettre (ex. 1912345A) ».

**US-M15-02 — En tant que gérant, je veux paramétrer la TVA.**

- Étant donné le régime `ENTREPRENANT` ou `RMI` sélectionné, alors le système propose « Désactiver la TVA » (`vatEnabled = false`) avec la mention légale par défaut « TVA non applicable — régime de la microentreprise » ; en `RNI`/`RSI`, TVA activée à 18 %, taux secondaires configurables (9 %, 0 %).

**US-M15-03 — En tant que gérant, je veux déclarer mes sites, ponts et horaires.**

- Étant donné « Atelier Yopougon » (code YOP), quand j'ajoute « Pont 1 » (LIFT), « Pont 2 » (LIFT), « Diagnostic » (DIAGNOSTIC), « Lavage » (WASH) et les horaires lun-ven 07:30–18:00, sam 08:00–14:00, alors M03 propose des créneaux dans ces horaires et M12 calcule l'occupation sur 3 ponts (WASH exclus).

**US-M15-04 — En tant que gérant, je veux gérer les jours fériés.**

- Étant donné l'année 2027, quand j'ouvre « Jours fériés », alors la liste ivoirienne fixe est pré-remplie (1er janvier, Lundi de Pâques, 1er mai, Ascension, Lundi de Pentecôte, 7 août, 15 août, 1er novembre, 15 novembre, 25 décembre) ; les fêtes religieuses variables (Aïd el-Fitr, Tabaski, Maouloud, Lendemain de la Nuit du Destin) sont pré-saisies avec la mention « Date à confirmer » et modifiables ; aucune relance automatique ni créneau n'est proposé ces jours-là.

**US-M15-05 — En tant que gérant, je veux tester mon canal WhatsApp avant de l'activer.**

- Étant donné la carte WhatsApp (fournisseur `whatsapp_cloud`), quand je saisis Phone Number ID, WABA ID, jeton d'accès et clique « Tester », alors le système appelle `healthCheck()` puis envoie le modèle `hello_world` (ou un modèle approuvé choisi) à mon numéro ; résultat « Connecté ✓ — message délivré à 09:12 » ou erreur traduite (« Jeton expiré : régénérez-le dans Meta Business »). Le jeton n'est plus jamais affiché (« •••• enregistré le 18/10/2026 »).

**US-M15-06 — En tant que gérant, je veux personnaliser la numérotation des documents.**

- Étant donné le format par défaut `{TYPE}-{SITE}-{AAAA}-{NNNNN}` pour OR et devis et `{TYPE}-{AAAA}-{NNNNNN}` pour les factures, quand je change le préfixe facture en « F » et le nombre de chiffres à 4, alors l'aperçu affiche « F-2026-0413 » (prochain numéro) ; la modification d'une séquence **facture** déjà utilisée dans l'année ne peut pas faire baisser `lastValue`.

**US-M15-07 — En tant que gérant, je veux connaître mon offre et ses limites.**

- Étant donné le plan `STARTER`, quand j'ouvre `/parametres/abonnement`, alors je vois les jauges « Utilisateurs 4/5 », « Sites 1/1 », « Messages automatiques ce mois 812/1 000 », « Crédits IA 340/500 », et les fonctions non incluses avec badge « PRO » ; « Changer d'offre » envoie une demande à l'équipe commerciale (v1 sans paiement en ligne de l'abonnement).

**US-M15-08 — En tant que gérant, je veux exporter toutes mes données.**

- Quand je clique « Exporter toutes mes données » et confirme par OTP, alors une archive ZIP (CSV par table + `photos/` + `documents/` PDF des factures + `LISEZMOI.txt`) est préparée en tâche de fond et un lien de téléchargement valable 48 h m'est envoyé par email et notification.

**US-M15-09 — En tant que gérant, je veux pouvoir supprimer mon compte.**

- Quand je demande la suppression, saisis le nom du garage et valide par OTP, alors l'organisation passe en « suppression programmée » à J+30 (accès en lecture seule, export possible, annulation possible) ; à J+30 les données personnelles sont effacées et les factures émises conservées sous forme anonymisée pendant la durée légale (10 ans, OHADA).

**US-M15-10 — En tant que gérant, je veux basculer entre « Relances seules » et « Gestion complète ».**

- Étant donné `operatingMode = REMINDERS_ONLY`, alors le menu ne montre que Tableau de bord, Relances, Créances, Clients & véhicules, Échéances, Messages, Import, Paramètres. Le passage en `FULL` se fait via l'assistant de migration M13 (ou directement si aucune source de synchro n'est active), avec confirmation et audit.

**US-M15-11 — En tant que gérant, je veux consulter le journal d'audit.**

- Étant donné `/parametres/journal`, quand je filtre « Factures » + « 01/10/2026–18/10/2026 », alors je vois chaque action (date, utilisateur, action en clair « a annulé la facture FAC-2026-000398 », motif, IP) et le détail avant/après en diff lisible ; export CSV.

## 4. Règles métier

### 4.1 Garage, fiscalité, sites

- **RG-M15-01 — Champs obligatoires pour émettre une facture (M08)** : `legalName`, `ncc`, `rccm`, `address`, `phone`, `taxRegime`. Tant qu'ils manquent, l'émission est bloquée avec la liste des champs et un lien vers `/parametres/garage`. Formats : NCC `^\d{7}[A-Z]$` ; RCCM `^CI-[A-Z]{3}-\d{4}-[A-Z]-\d{1,6}$` (avertissement seulement si non conforme, les anciens formats existent).
- **RG-M15-02 — TVA.** `vatRate` (défaut 18) appliqué par défaut aux produits et MO ; `settings.tax.rates = [18, 9, 0]` proposés dans les listes ; `vatEnabled = false` force `vatRate = 0` sur les nouveaux documents (les documents émis ne changent jamais). Mode d'arrondi `settings.tax.rounding = "PER_LINE" | "PER_DOCUMENT"` (défaut PER_LINE, cf. 01 §7). Changer le régime ou la TVA s'applique **aux nouveaux documents uniquement** ; un devis non converti garde ses taux et un bandeau signale l'écart.
- **RG-M15-03 — Mentions.** `invoiceFooter` (≤ 500 caractères) + mentions par document dans `settings.documents.{quote|invoice|repairOrder|receipt}.footer` : conditions de paiement, pénalités de retard, garantie pièces/MO (défaut « Garantie 3 mois ou 5 000 km sur pièces et main-d'œuvre »), RIB, numéros marchands Wave/OM/MTN (`settings.payments.merchantNumbers`).
- **RG-M15-04 — Logo** : PNG/JPG/SVG ≤ 1 Mo, redimensionné à 600 px de large, stocké S3 ; une version 192×192 sert d'icône PWA et d'en-tête portail.
- **RG-M15-05 — Sites.** Code de 2 à 5 lettres majuscules, unique, **non modifiable** après la création du premier document (il est dans les numéros). Désactiver un site : refusé s'il reste des OR ouverts, du stock > 0 ou une caisse ouverte (« Clôturez 3 OR et transférez le stock avant de désactiver Atelier Cocody »). Nombre de sites actifs ≤ limite du plan (RG-M15-20).
- **RG-M15-06 — Ponts** : nom unique par site, type `BayType`, actif/inactif ; désactivation refusée si des RDV futurs y sont affectés (proposer de les réaffecter).
- **RG-M15-07 — Horaires** : `Site.openingHours` au format `{ mon: [["07:30","12:00"],["13:00","18:00"]], …, sun: [] }`, plages non chevauchantes, fin > début, pas de pas inférieur à 15 min. Fermetures exceptionnelles = `Holiday` avec `siteId`.
- **RG-M15-08 — Jours fériés** : modèle `Holiday` (§14) ; génération annuelle automatique le 1er décembre pour l'année suivante (tâche `holidays.seed`) depuis `core/calendar/ci-holidays.ts` (fêtes fixes + Pâques calculé par l'algorithme de Meeus ; fêtes musulmanes à date estimée marquées `isEstimated = true` et notification au gérant 7 jours avant pour confirmation). Effets : M10 décale les envois au jour ouvré suivant, M03 ne propose aucun créneau, M12 exclut de la capacité.

### 4.2 Atelier

- **RG-M15-09 — Taux horaires** par type (`LaborRateType`) dans `settings.labor.rates` : défauts STANDARD 15 000, DIAGNOSTIC 20 000, BODYWORK 15 000, ELECTRICAL 18 000 FCFA HT/h ; possibilité de taux par site (`settings.labor.ratesBySite[siteId]`). Prix d'une ligne MO = `fixedPrice` si défini, sinon `standardHours × taux`. Exemple : « Vidange moteur + filtre », 0,5 h STANDARD → 7 500 FCFA HT.
- **RG-M15-10 — Catalogue MO** (`LaborOperation`) : code unique par organisation, nom, catégorie, temps barème (pas de 0,1 h), type de taux, forfait ; import/export CSV ; désactivation logique (jamais de suppression si utilisé). Catalogue initial de 40 opérations courantes fourni au seed (vidange, plaquettes, disques, courroie de distribution, pré-visite technique, diagnostic électronique, recharge climatisation…).
- **RG-M15-11 — Modèles d'inspection** (`InspectionTemplate.items = [{category, label, measurementUnit?}]`) : modèle par défaut « Inspection 30 points » (Freinage, Pneumatiques, Éclairage, Liquides, Suspension, Échappement, Batterie, Climatisation, Carrosserie) + « Pré-visite technique » ; duplication, réordonnancement par glisser-déposer ; un modèle utilisé par une inspection n'est modifiable qu'en créant une nouvelle version (`version` +1).

### 4.3 Documents

- **RG-M15-12 — Numérotation** : format par `docType` (`OR`, `DEV`, `FAC`, `AV`, `REC`, `BC`, `INV`, `TR`) dans `settings.numbering[docType] = { prefix, pattern, padding, perSite, resetYearly }`. Jetons : `{TYPE}`, `{SITE}`, `{AAAA}`, `{AA}`, `{MM}`, `{N…}` (padding). Contraintes : `FAC`, `AV`, `REC` **sans trou**, `resetYearly = true`, `{AAAA}` obligatoire ; pattern doit garantir l'unicité (contient `{N}` et `{AAAA}` ou `resetYearly = false`). Valeur de départ modifiable seulement **à la hausse** (`newStart > lastValue`), auditée. Prochain numéro affiché = rendu de `lastValue + 1`.
- **RG-M15-13 — Modèles PDF** : choix parmi 3 gabarits (`classique`, `moderne`, `compact`) dans `packages/pdf`, couleur principale, police (système), affichage des colonnes (remise, réf. pièce, mécanicien), format A4 ; options : montant en lettres (« Cent quatre-vingt-cinq mille francs CFA »), signature/cachet du garage (image), conditions générales en page 2. Aperçu PDF en direct sur un document fictif.

### 4.4 Relances, communication, paiement, FNE

- **RG-M15-14 — Règles de relance** : écran `/parametres/relances` = **frise** par `ReminderType` (spécification complète et validations dans M10) ; M15 fournit le conteneur, la navigation et l'audit `reminder_rule.update`.
- **RG-M15-15 — Canaux** : une carte par canal (WhatsApp, SMS, Email) avec fournisseurs listés (`ChannelConfig.provider`) et champs par fournisseur :

| Fournisseur      | Champs (secrets en gras)                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `whatsapp_cloud` | phoneNumberId, wabaId, **accessToken**, **appSecret** (vérif. webhook), verifyToken (généré)  |
| `wa_link`        | numéro affiché (aucun secret)                                                                 |
| `orange_sms`     | **clientId**, **clientSecret**, senderName (≤ 11 car.), senderAddress (`tel:+225…`)           |
| `twilio`         | accountSid, **authToken**, from / messagingServiceSid                                         |
| `http_sms`       | URL, méthode, **en-têtes d'authentification**, gabarit de corps JSON avec `{{to}}` `{{text}}` |
| `smtp`           | hôte, port, sécurité, utilisateur, **mot de passe**, from                                     |
| `resend`         | **apiKey**, from (domaine vérifié)                                                            |

Actions : « Tester » (`healthCheck` + envoi d'un message réel au numéro/email de l'utilisateur courant), « Activer », ordre de priorité et de repli (WhatsApp → SMS → Email, `ChannelConfig.priority`), URL de webhook à copier (`/api/webhooks/whatsapp/{orgPublicId}`), solde SMS (`balance`) rafraîchi toutes les 6 h, seuil d'alerte `settings.channels.lowBalanceThreshold` (défaut 500).

- **RG-M15-16 — Chiffrement des secrets** : `credentials` = JSON chiffré AES-256-GCM (`iv` 12 octets aléatoires + `tag` + texte chiffré, base64, préfixe de version `v1:`) avec `ENCRYPTION_KEY` ; fonction `core/crypto/secrets.ts` (`encryptJson`, `decryptJson`). Les procédures de lecture renvoient `{ configured: true, last4?: "…a91F", updatedAt }`, **jamais** la valeur. Mise à jour partielle : un champ secret vide = inchangé. Rotation de clé maîtresse : support de `ENCRYPTION_KEY_PREVIOUS` et tâche `secrets.reencrypt`. Logs : sérialiseur pino qui masque `credentials`, `password`, `token`, `secret`, `apiKey`.
- **RG-M15-17 — Fournisseurs de paiement** : `PaymentProviderConfig` `cinetpay` (apiKey, siteId, **secretKey**) et `wave` (**apiKey**, **webhookSecret**) ; moyens couverts (`methods`) ; test = création d'un lien de 100 FCFA en mode test puis annulation ; numéros marchands manuels (`settings.payments.merchantNumbers = { wave, orangeMoney, mtn, moov }`) utilisés dans les modèles et le portail quand aucun fournisseur n'est actif.
- **RG-M15-18 — FNE** : `FneConfig.mode` `disabled | manual | api` ; en `api` : identifiants DGI (chiffrés), `establishmentId`, `pointOfSale`, bouton « Tester la certification » (facture de test si l'API DGI le permet, sinon test d'authentification). Passage en `disabled` exige un motif et affiche l'avertissement légal (« Depuis l'arrêté n°0337 du 9 mai 2025, vos factures doivent être normalisées »). Détails de l'adaptateur dans M08.

### 4.5 Plans, données, mode

- **RG-M15-19 — Catalogue des plans** (`packages/core/billing/plans.ts`, surcharge possible par organisation dans `Organization.planOverrides` par l'équipe AtelierOS) :

| Limite / fonction                            | STARTER                        | PRO               | NETWORK   |
| -------------------------------------------- | ------------------------------ | ----------------- | --------- |
| Utilisateurs actifs (RG-M01-13)              | 5                              | 15                | illimité  |
| Sites actifs                                 | 1                              | 3                 | illimité  |
| Messages automatiques (relances) / mois      | 1 000                          | 5 000             | 20 000    |
| Crédits IA / mois (M17)                      | 500                            | 3 000             | 10 000    |
| Stockage fichiers                            | 5 Go                           | 25 Go             | 100 Go    |
| Sources de synchro (M13)                     | 1 (fichier, dossier surveillé) | 3 (+ base, agent) | illimité  |
| API publique + webhooks                      | lecture seule                  | oui               | oui       |
| Rate-limit API                               | 60/min                         | 300/min           | 1 200/min |
| Comparaison multi-sites, transferts de stock | —                              | —                 | oui       |
| Portail client, vue flotte                   | devis + facture                | complet           | complet   |
| Assistant IA conversationnel                 | —                              | oui               | oui       |
| Historique d'audit consultable               | 90 j                           | 1 an              | 3 ans     |

Le coût des SMS/WhatsApp facturés par les fournisseurs reste à la charge du garage (ses propres comptes).

- **RG-M15-20 — Application des limites** : `core/billing/limits.ts` `checkLimit(org, key, increment)` appelé avant création (membre, site, source, clé API) → erreur `PLAN_LIMIT_REACHED` « Votre offre STARTER permet 1 site. Passez à l'offre PRO. » ; quotas mensuels (messages, IA) comptés dans `UsageCounter` (§14), remis à zéro le 1er du mois (fuseau org). À 80 % → notification ; à 100 % : relances automatiques passent en `NEEDS_APPROVAL` (jamais de perte silencieuse), messages manuels et transactionnels (facture, véhicule prêt, OTP) toujours autorisés ; IA → dégradation M17. Rétrogradation de plan : rien n'est supprimé, les éléments au-delà de la limite deviennent en lecture seule (sites désactivés au choix du gérant).
- **RG-M15-21 — Export complet** : tâche `org.export` (file `exports`) ; CSV UTF-8 avec BOM, séparateur `;`, une table par fichier (toutes les tables métier de l'organisation, secrets exclus, `credentials` exclus, hash de mots de passe exclus), photos et PDF de factures émises ; ZIP chiffré AES-256 (mot de passe affiché une fois) si `settings.security.encryptExports = true` ; lien S3 signé 48 h ; 1 export / 24 h ; audit `org.export`.
- **RG-M15-22 — Suppression de compte** : `Organization.deletionRequestedAt`, `deletionScheduledFor = +30 j` ; pendant le délai : connexion en lecture seule, relances/envois/synchros/API **suspendus**, bannière d'annulation ; à l'échéance, tâche `org.purge` : suppression des données personnelles (clients, véhicules, messages, photos, contacts), révocation des clés/jetons, conservation des `Invoice`/`InvoiceLine`/`Payment` émis avec client anonymisé (`displayName = "Client supprimé #<hash>"`, téléphone/email nuls) pendant 10 ans, puis suppression. Suppression d'un **client** à sa demande (ARTCI) : même anonymisation, traitée dans M02.
- **RG-M15-23 — Mode de fonctionnement** : `REMINDERS_ONLY` masque les modules OR, devis, atelier, stock, achats, caisse et facturation émettrice (M08 limité à l'enregistrement de paiements sur factures importées) ; les routes correspondantes renvoient vers `/tableau-de-bord` avec « Cette fonction est disponible en gestion complète ». `FULL` : tout. Transition auditée (`org.operating_mode_changed`) ; règles détaillées de bascule dans M13 RG-M13-43.
- **RG-M15-24 — Sauvegardes** : base sauvegardée quotidiennement + PITR par la plateforme (01 §8) ; l'écran affiche la date de la dernière sauvegarde réussie et du dernier test de restauration (`backups.verify`) — information seule, aucune restauration self-service (demande au support).

### 4.6 Journal d'audit

- **RG-M15-25 — Contenu** : `AuditLog` immuable (aucune procédure de modification/suppression ; RLS `INSERT`/`SELECT` seulement, rôle applicatif sans `UPDATE/DELETE` sur la table). Actions obligatoirement journalisées : toutes celles listées en 01 §4 et M01 RG-M01-15, plus `settings.*`, `channel.*`, `payment_provider.*`, `fne_config.*`, `numbering.*`, `plan.*`, `api_key.*`, `org.export`, `org.deletion_*`, `support.access`. Valeurs secrètes remplacées par `"[secret modifié]"` dans `before/after`.
- **RG-M15-26 — Libellés** : chaque `action` a un libellé français dans `fr.json` (`audit.invoice.void = "a annulé la facture {number}"`). Rétention affichée selon le plan (RG-M15-19), conservation en base 10 ans.
- **RG-M15-27 — Accès support** : un membre de l'équipe AtelierOS ne peut accéder à une organisation qu'après autorisation de l'OWNER (« Autoriser le support pendant 24 h ») ; chaque accès est audité `support.access` et visible dans le journal.

## 5. Machine à états

Organisation (cycle de vie, §14 `lifecycleStatus`) : `ACTIVE → DELETION_SCHEDULED` (demande OTP) `→ ACTIVE` (annulation) | `PURGED` (J+30). `ACTIVE ↔ SUSPENDED` (équipe AtelierOS, impayé d'abonnement : lecture seule, relances suspendues).
`ChannelConfig.status` : `null` (non testé) → `OK` | `ERROR` (dernier test ou échec d'envoi d'authentification) ; `isActive` ne peut passer à `true` qu'après un test `OK`.

## 6. Données

`Organization` (identité, `taxRegime`, `vatRate`, `vatEnabled`, `plan`, `operatingMode`, `settings`), `Site`, `Bay`, `Membership`, `LaborOperation`, `InspectionTemplate`, `DocumentSequence`, `ReminderRule`, `MessageTemplate`, `ChannelConfig`, `PaymentProviderConfig`, `FneConfig`, `ApiKey`, `WebhookEndpoint`, `DataSource`, `AuditLog`. Ajouts §14 : `Holiday`, `UsageCounter`, `DataExport`, champs `Organization` (cycle de vie, slug, surcharges de plan), `InspectionTemplate.version`.
Schéma Zod `OrganizationSettingsSchema` (`packages/validators/settings.ts`) qui valide **tout** `Organization.settings` avec valeurs par défaut : `tax`, `documents`, `numbering`, `labor`, `payments`, `channels`, `portal` (M14), `reports`/`alerts`/`digest` (M12), `ai` (M17), `atelier` (M06), `stock` (M07), `security` (M01), `onboarding` (M01), `costs` (M12). Lecture via `getSettings(org)` qui fusionne les défauts.

## 7. Écrans et interface

`/parametres` : navigation latérale (PC) ou liste (mobile) ; chaque page = formulaire React Hook Form + Zod, bouton « Enregistrer » collant, détection de modifications non enregistrées, toast de succès.

| Route                                            | Contenu                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/parametres/garage`                             | Identité légale, contacts, logo, régime fiscal, TVA, mentions ; aperçu de l'en-tête de facture                                                                      |
| `/parametres/sites` · `/parametres/sites/[id]`   | Liste des sites ; fiche : adresse, commune, téléphone, WhatsApp, horaires (éditeur par jour avec plages), ponts (liste éditable)                                    |
| `/parametres/jours-feries`                       | Calendrier annuel, liste, « Ajouter une fermeture », filtre par site                                                                                                |
| `/parametres/utilisateurs` · `/parametres/roles` | Spécifié dans M01                                                                                                                                                   |
| `/parametres/main-oeuvre`                        | Taux horaires par type (et par site) ; catalogue MO (tableau, recherche, import CSV)                                                                                |
| `/parametres/inspection`                         | Modèles d'inspection, éditeur par catégories                                                                                                                        |
| `/parametres/documents`                          | Numérotation (aperçu du prochain numéro par type), modèles PDF (aperçu), mentions par document                                                                      |
| `/parametres/relances`                           | Frise des règles (spécifiée dans M10) + modèles de messages (M11)                                                                                                   |
| `/parametres/canaux`                             | Cartes WhatsApp / SMS / Email : statut (Connecté / Non configuré / Erreur, avec icône et texte), fournisseur, « Configurer », « Tester », ordre de repli, solde SMS |
| `/parametres/paiements`                          | Fournisseurs (CinetPay, Wave), moyens, test ; numéros marchands                                                                                                     |
| `/parametres/fne`                                | Mode, identifiants, test, statut des dernières certifications                                                                                                       |
| `/parametres/portail`                            | Paramètres M14 (activation, couleur, signature, paiement partiel, RDV en ligne, lien avis Google)                                                                   |
| `/parametres/notifications`                      | Résumé quotidien et alertes (M12)                                                                                                                                   |
| `/parametres/ia`                                 | Paramètres M17 (fonctions activées, consommation)                                                                                                                   |
| `/parametres/import`                             | Renvoi vers `/import` et `/import/sources` (M13)                                                                                                                    |
| `/parametres/api`                                | Clés API, webhooks (M13)                                                                                                                                            |
| `/parametres/abonnement`                         | Plan actuel, jauges d'usage, comparatif, « Demander un changement d'offre »                                                                                         |
| `/parametres/donnees`                            | Mode de fonctionnement, sauvegardes (info), export complet, suppression du compte (zone rouge, en bas)                                                              |
| `/parametres/journal`                            | Journal d'audit : filtres (utilisateur, module, action, période, entité), tableau, détail diff, export CSV                                                          |

Formulaires de secrets : champ type mot de passe, placeholder « •••• enregistré le 18/10/2026 », lien « Remplacer ». Mobile : toutes les pages utilisables, éditeurs complexes (horaires, inspection) en pile verticale.

## 8. API

| Procédure tRPC                                                      | Entrée                                                                      | Sortie                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `settings.get`                                                      | `{ section? }`                                                              | settings fusionnés aux défauts (sans secrets)                                         |
| `settings.update`                                                   | `{ section, values }` (validé par la partie du schéma)                      | settings                                                                              |
| `org.get` / `org.update`                                            | — / identité, fiscalité, logoUploadId                                       | `Organization`                                                                        |
| `org.uploadLogo`                                                    | `{ mimeType, size }`                                                        | `{ uploadUrl, uploadId }`                                                             |
| `sites.list/create/update/deactivate`                               | `SiteInput`                                                                 | `Site`                                                                                |
| `bays.create/update/deactivate/reorder`                             | `BayInput`                                                                  | `Bay`                                                                                 |
| `holidays.list/create/update/delete/seedYear`                       | `{ year, siteId? }` / `HolidayInput`                                        | `Holiday[]`                                                                           |
| `labor.rates.update`                                                | `{ rates, ratesBySite? }`                                                   | ok                                                                                    |
| `laborOperations.list/create/update/deactivate/importCsv/exportCsv` | …                                                                           | …                                                                                     |
| `inspectionTemplates.list/create/update/duplicate/archive`          | …                                                                           | …                                                                                     |
| `numbering.get` / `numbering.update`                                | — / `{ docType, prefix, pattern, padding, perSite, resetYearly, startAt? }` | `{ docType, nextPreview }[]`                                                          |
| `pdfTemplates.update` / `pdfTemplates.preview`                      | options / `{ docType }`                                                     | ok / `{ url }`                                                                        |
| `channels.list`                                                     | —                                                                           | `[{ channel, provider, isActive, status, senderId, balance, configured, updatedAt }]` |
| `channels.upsert`                                                   | `{ channel, provider, credentials (écriture seule), senderId, priority }`   | idem sans secrets                                                                     |
| `channels.test`                                                     | `{ id, to? }`                                                               | `{ ok, latencyMs, messageId?, error? }`                                               |
| `channels.activate` / `deactivate` / `reorder`                      | …                                                                           | …                                                                                     |
| `paymentProviders.list/upsert/test/activate`                        | …                                                                           | …                                                                                     |
| `fne.getConfig/updateConfig/test`                                   | …                                                                           | …                                                                                     |
| `plan.get`                                                          | —                                                                           | `{ plan, limits, usage }`                                                             |
| `plan.requestChange`                                                | `{ targetPlan, message? }`                                                  | `{ ok }`                                                                              |
| `org.setOperatingMode`                                              | `{ mode, reason }`                                                          | ok (FULL via M13 si sources actives)                                                  |
| `dataExport.request` / `dataExport.list`                            | `{ otp }` / —                                                               | `{ exportId }` / exports                                                              |
| `org.requestDeletion` / `org.cancelDeletion`                        | `{ confirmName, otp, reason? }` / —                                         | `{ scheduledFor }` / ok                                                               |
| `audit.list`                                                        | `{ filters, cursor }`                                                       | `{ items, nextCursor }`                                                               |
| `audit.export`                                                      | `{ filters }`                                                               | `{ url }`                                                                             |
| `support.grantAccess` / `revokeAccess`                              | `{ hours: 24 }`                                                             | ok                                                                                    |

## 9. Automatisations et événements

- Émis : `settings.updated` (`{ section }`) → invalidation des caches (M12, M10 planification), `site.created` (M01), `channel.status_changed` (M12 alerte `channel_error`), `org.operating_mode_changed`, `plan.limit_reached`.
- Tâches : `holidays.seed` (1er décembre), `channels.health` (toutes les 6 h : `healthCheck` + solde), `usage.reset` (1er du mois 00:05 locale), `org.export`, `org.purge` (quotidienne, organisations à échéance), `secrets.reencrypt` (manuelle).

## 10. Permissions

| Action                                                                   | Permission                       | Rôles par défaut                    |
| ------------------------------------------------------------------------ | -------------------------------- | ----------------------------------- |
| Consulter les paramètres (sans secrets)                                  | `settings:read`                  | OWNER, MANAGER, ADVISOR, ACCOUNTANT |
| Identité, TVA, mentions, numérotation, PDF, mode, portail, notifications | `settings:update` / `org:update` | OWNER                               |
| Sites et ponts, horaires, jours fériés                                   | `site:manage`                    | OWNER                               |
| Catalogue MO, taux horaires                                              | `labor_catalog:manage`           | OWNER, MANAGER                      |
| Modèles d'inspection                                                     | `inspection:template_manage`     | OWNER, MANAGER                      |
| Canaux                                                                   | `settings:channels`              | OWNER                               |
| Paiement                                                                 | `settings:payments`              | OWNER                               |
| FNE                                                                      | `settings:fne`                   | OWNER                               |
| Abonnement, export complet, suppression de compte, accès support         | `settings:billing`               | OWNER                               |
| Journal d'audit                                                          | `audit:read`                     | OWNER, MANAGER, ACCOUNTANT          |

Export complet et suppression exigent en plus un OTP frais (< 5 min) du demandeur.

## 11. Cas limites et erreurs

- Deux OWNER modifient la même section → verrou optimiste (`settings.version`) : « Ces paramètres ont été modifiés par Konan Serge à 10:42. Rechargez avant d'enregistrer. »
- Changement de fuseau horaire alors que des relances sont planifiées → confirmation ; M10 replanifie les `Reminder.scheduledFor` non envoyés.
- Désactivation du dernier canal actif → avertissement « Plus aucune relance ne pourra partir » + relances automatiques passées en `NEEDS_APPROVAL`.
- Test WhatsApp : numéro du testeur hors fenêtre de 24 h et modèle non approuvé → « Meta exige un modèle approuvé pour un premier message : choisissez un modèle APPROVED » .
- `ENCRYPTION_KEY` absente/invalide au démarrage → l'application refuse de démarrer (erreur explicite dans les logs).
- Clé de chiffrement changée sans `ENCRYPTION_KEY_PREVIOUS` → configs marquées `ERROR` « Secret illisible, ressaisissez-le », sans plantage.
- Modification de la numérotation facture en cours d'année → seule la partie préfixe/padding est modifiable pour les nouveaux numéros ; jamais de renumérotation des factures émises.
- Suppression demandée alors que des factures FNE sont `PENDING` → suppression refusée tant qu'elles ne sont pas certifiées ou traitées.
- Logo SVG contenant du script → rejeté (« Fichier SVG non autorisé : contient du code ») ; SVG assaini par `DOMPurify` côté serveur.

## 12. Tests

- **Unitaires** : `core/crypto/secrets` (aller-retour, IV unique, altération du tag → erreur, rotation de clé) ; `core/numbering` rendu des patterns et interdiction de baisse ; `core/calendar/ci-holidays` (Pâques 2027 = 28/03 → Lundi de Pâques 29/03, Ascension 06/05, Pentecôte 17/05) ; `core/billing/limits` (80 %, 100 %, rétrogradation) ; `OrganizationSettingsSchema` (défauts, valeurs invalides) ; validation NCC/RCCM.
- **Intégration** : aucune procédure ne renvoie un champ secret (test qui parcourt toutes les sorties du routeur `settings`, `channels`, `paymentProviders`, `fne` et cherche les valeurs de test) ; journalisation d'audit de chaque mutation ; immuabilité `AuditLog` (UPDATE refusé par la base) ; export complet (toutes les tables, aucune donnée d'une autre organisation) ; purge après J+30 avec horloge simulée.
- **E2E Playwright** : nouveau garage → identité + TVA → site + 3 ponts + horaires → canal WhatsApp `console` testé et activé → aperçu numérotation facture → journal d'audit montre les 5 actions.

## 13. Définition de « terminé »

- [ ] Toutes les pages §7 avec validation Zod, états chargement/erreur, mobile.
- [ ] Secrets chiffrés, jamais renvoyés ni journalisés ; tests de non-fuite verts.
- [ ] Jours fériés CI générés, pris en compte par M03/M10/M12.
- [ ] Numérotation configurable sans trou pour FAC/AV/REC.
- [ ] Plans et limites appliqués côté serveur, jauges d'usage.
- [ ] Export complet, suppression programmée et purge testées.
- [ ] Journal d'audit immuable, lisible en français, filtrable, exportable.

> **Livraison étape 6.5 (20/10/2026)** — catalogue des plans unique `core/billing/plans.ts` (A12 ; RG-M01-13 et crédits IA de M17 en dérivent) et `core/billing/limits.ts` (`checkLimit`, 80 %/100 %, message « Votre offre STARTER permet 1 site. Passez à l'offre PRO. », impact de rétrogradation) ; `enforcePlanLimit` (packages/db) appelé avant création de site, invitation/réactivation de membre et onboarding ; `UsageCounter` mensuel `auto_messages` dans `reminders.dispatch` (100 % → `NEEDS_APPROVAL`, relances approuvées à la main ni bloquées ni comptées, notifications OWNER à 80 % et 100 %) ; facturation de l'abonnement derrière `SubscriptionBillingProvider` (`manual` par défaut : demande tracée `plan.change_requested`, plan inchangé ; `fake` : appliqué immédiatement, interdit si `APP_ENV=production`) ; `/parametres/abonnement` (jauges, comparatif, demande) ; export complet `org.export` (file `exports`, ZIP : un CSV UTF-8 BOM « ; » par table issue du DMMF via `db.forTenant`, `user.csv`, `photos/`, `documents/` PDF des factures émises, `LISEZMOI.txt` ; secrets, empreintes et jetons exclus ; OTP frais ; 1 export / 24 h ; lien `/api/exports/{id}` → URL S3 signée 5 min, valable 48 h, audité) ; suppression programmée J+30 (nom du garage + OTP, lecture seule de toutes les mutations tRPC sauf annulation/export, bandeau, relances et automatisations suspendues) et purge `org.purge` quotidienne ; accès support 24 h audité ; rétention d'affichage du journal par plan ; pages `/parametres/garage`, `/parametres/jours-feries`, `/parametres/documents`, `/parametres/donnees` ; navigation complétée (canaux, modèles, relances, planning). Écarts :
>
> 1. Abonnement `manual` : aucune notification réelle à l'équipe commerciale (hook `notify` vide) ni outil interne pour appliquer un changement ou des `planOverrides` (via la base / le support).
> 2. Rétrogradation : impact affiché, rien supprimé, mais les éléments au-delà de la limite ne sont pas mis en lecture seule un par un (seules les nouvelles créations sont bloquées).
> 3. Limites `dataSources`/`apiKeys` prêtes mais sans point d'appel (aucune création côté M13 partie 2, en pause) ; stockage : jauge seule, sans blocage à l'upload ; rate-limit API par plan non appliqué (pas d'API publique) ; fonctions par plan (multi-sites, portail) laissées aux modules concernés.
> 4. Crédits IA : compteur de M17 (somme `AiInteraction.credits`) réutilisé, pas de `UsageCounter ai_credits` (pas de double comptage) ; `storage_bytes` calculé à la volée ; `usage.reset` implicite (période « AAAA-MM » dans le fuseau de l'organisation).
> 5. Export : ZIP non chiffré (`settings.security.encryptExports` non livré) ; lien signalé par notification in-app, pas par email (aucun canal email transactionnel vers les utilisateurs) ; archive construite en mémoire (au-delà de 1 Go → `FAILED`). Tables exclues : `PortalToken`, `TrustedDevice`, `DataExport`, `DomainEvent`, `TechSyncOperation`, `PaymentWebhookLog`, `ApiKey`.
> 6. Purge : anonymisation (clients « Client supprimé #hash », véhicules, contacts, messages) plutôt que suppression physique, à cause des clés étrangères des factures et historiques ; notes, pièces jointes (et objets S3), fils IA, notifications, invitations, jetons portail, désinscriptions et appareils de confiance supprimés ; clés et secrets révoqués. La suppression définitive à 10 ans n'est pas planifiée.
> 7. Lecture seule : endpoints REST (webhooks entrants) non bloqués ; aucun outil pour poser `SUSPENDED` (équipe AtelierOS) ; l'autorisation d'accès support est enregistrée mais aucun outil de connexion support ne la consomme encore.
> 8. Champs §14 créés mais pas encore exploités : `settingsVersion` (verrou optimiste), `Site.timezone`, `InspectionTemplate.version` (`isArchived` non créé : `isActive = false` en tient lieu). `slug` : créé nullable par M14 (étape 6.3) ; la migration M15 ne le crée que s'il n'existe pas (ordre de fusion indifférent), remplit les valeurs manquantes puis le rend obligatoire ; valeur par défaut `cuid`, « excellence-auto » pour l'organisation de démo.
> 9. Pages : pas de téléversement de logo ni d'alerte de modifications non enregistrées sur `/parametres/garage` ; jours fériés en liste (pas de vue calendrier, pas de filtre par site) ; l'aperçu de numérotation est recalculé côté navigateur.

## 14. Évolutions du modèle de données

```prisma
model Holiday {
  id             String   @id @default(cuid())
  organizationId String
  siteId         String?                       // null = tous les sites
  date           DateTime @db.Date
  name           String                        // "Fête de l'Indépendance"
  kind           String   @default("PUBLIC")   // PUBLIC | CLOSURE
  isEstimated    Boolean  @default(false)      // fêtes religieuses à confirmer
  @@unique([organizationId, siteId, date])
}

model UsageCounter {                           // quotas mensuels (messages auto, crédits IA, stockage)
  id             String   @id @default(cuid())
  organizationId String
  metric         String                        // auto_messages | ai_credits | storage_bytes
  period         String                        // "2026-10"
  used           Int      @default(0)
  @@unique([organizationId, metric, period])
}

model DataExport {
  id             String   @id @default(cuid())
  organizationId String
  requestedById  String
  status         String   @default("PENDING")  // PENDING | RUNNING | READY | FAILED | EXPIRED
  fileUrl        String?
  sizeBytes      Int?
  expiresAt      DateTime?
  error          String?
  createdAt      DateTime @default(now())
}

// Ajouts à Organization
//   slug                 String   @unique          // aussi utilisé par M14
//   lifecycleStatus      OrgLifecycle @default(ACTIVE)
//   deletionRequestedAt  DateTime?
//   deletionScheduledFor DateTime?
//   planOverrides        Json     @default("{}")  // surcharges de limites par l'équipe AtelierOS
//   settingsVersion      Int      @default(0)     // verrou optimiste
//   supportAccessUntil   DateTime?
enum OrgLifecycle { ACTIVE SUSPENDED DELETION_SCHEDULED PURGED }

// Ajouts à InspectionTemplate
//   version    Int      @default(1)
//   isDefault  Boolean  @default(false)
//   isArchived Boolean  @default(false)
//   items : [{ category, label, measurementUnit? }]

// Ajouts à Site
//   timezone   String?                           // surcharge éventuelle du fuseau de l'organisation

// Ajouts à ChannelConfig
//   lastError   String?
//   updatedAt   DateTime @updatedAt
```
