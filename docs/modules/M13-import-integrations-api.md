# M13 — Import, synchronisation et API

> Priorité : P0 (import fichier) / P1 (synchro base, agent local, API publique, webhooks) · Dépend de : M01, M02, M08, M09, M10, M15, M17 (correspondance de colonnes) · Rôles concernés : OWNER, MANAGER, ACCOUNTANT, intégrateurs externes

## 1. Objectif

Le client pilote garde son logiciel de gestion existant. AtelierOS doit donc être alimenté **sans ressaisie** par trois voies : (1) import de fichiers Excel/CSV, (2) synchronisation automatique (dossier surveillé, connexion directe en lecture seule à la base de l'ancien logiciel, agent local), (3) API REST publique et webhooks sortants. Les mêmes mécanismes servent à la **migration complète** vers AtelierOS (passage de `operatingMode` `REMINDERS_ONLY` à `FULL`). Toute la logique d'analyse, de normalisation et de dédoublonnage vit dans `packages/core/import` (fonctions pures), le traitement tourne dans le worker (file `imports`).

## 2. Utilisateurs et cas d'usage

| Rôle | Ce qu'il fait | Fréquence |
|---|---|---|
| OWNER | Premier import, choix du mode d'alimentation, bascule FULL | Ponctuel |
| ACCOUNTANT / MANAGER | Importe chaque semaine l'export des factures impayées et des paiements | Hebdomadaire |
| OWNER (`integration:manage`) | Configure la connexion base / l'agent / les clés API / webhooks | Ponctuel |
| Intégrateur / logiciel tiers | Pousse clients, véhicules, factures, paiements par l'API ; reçoit des webhooks | Continu |
| Worker | Exécute dossiers surveillés et synchros planifiées | Toutes les 15 min |

## 3. User stories

**US-M13-01 — En tant que gérant, je veux importer mon fichier Excel de clients sans le retoucher afin de démarrer en 15 minutes.**
- Étant donné un fichier `clients.xlsx` (Windows-1252, colonnes « Nom & Prénoms », « Tél. », « Cel », « Immat », « Date VT »), quand je le dépose sur `/import/fichier`, alors l'encodage, la feuille et la ligne d'en-tête sont détectés, et chaque colonne est associée automatiquement (coche verte = synonyme connu, coche orange = proposition IA à confirmer, gris = ignorée).
- Étant donné que je valide la correspondance, alors j'obtiens une **simulation** : « 412 clients à créer, 37 à mettre à jour, 7 lignes en erreur, 3 doublons fusionnés » sans aucune écriture en base.

**US-M13-02 — En tant que gérant, je veux voir et corriger les erreurs avant d'importer.**
- Étant donné une ligne avec le téléphone « 0708 12 34 5 » (9 chiffres), alors elle est surlignée en rouge avec « Téléphone invalide : 9 chiffres au lieu de 10 » ; je peux corriger la cellule dans l'aperçu ou choisir « Ignorer les lignes en erreur ».
- Quand je clique « Importer », alors seules les lignes valides sont écrites et un **rapport d'erreurs** `.xlsx` (lignes d'origine + colonne « Erreur ») est téléchargeable.

**US-M13-03 — En tant que comptable, je veux réimporter chaque semaine l'état des impayés sans créer de doublons.**
- Étant donné qu'une facture F-2026-0412 (185 000 FCFA, solde 185 000) a déjà été importée, quand je réimporte un fichier où son solde vaut 0, alors la facture n'est pas recréée, un `Payment` de reprise (`method = OTHER`, `reference = "IMPORT-SOLDE"`) de 185 000 FCFA est alloué, son statut passe à `PAID` et les relances s'arrêtent (`payment.received`).
- Étant donné une ligne strictement identique (même `hash`), alors elle est comptée « inchangée » et aucune écriture n'a lieu.

**US-M13-04 — En tant que gérant, je veux télécharger des modèles de fichier.**
- Quand je clique « Télécharger le modèle » pour une entité, alors je reçois un `.xlsx` avec en-têtes français, une ligne d'exemple (Kouassi Jean-Marc, +225 07 47 21 88 90, 2547 GH 01) et un onglet « Aide » listant format et caractère obligatoire de chaque colonne.

**US-M13-05 — En tant que gérant, je veux que l'export nocturne de mon logiciel soit importé tout seul.**
- Étant donné une source `WATCHED_FOLDER` (dossier SFTP / dossier partagé de l'agent local) et un mapping enregistré, quand un fichier `export_2026-10-18.csv` apparaît, alors il est importé dans les 15 minutes avec ce mapping, puis déplacé dans `traites/` (ou `erreurs/`), et le résultat apparaît dans l'historique.

**US-M13-06 — En tant que gérant, je veux connecter AtelierOS directement à la base de mon logiciel.**
- Étant donné le formulaire « Connexion directe » (SQL Server, hôte, port, base, utilisateur, mot de passe), quand je clique « Tester la connexion », alors je vois « Connexion réussie — 14 tables visibles » ou une erreur claire (« Hôte injoignable depuis internet : installez l'agent local »).
- Étant donné des requêtes configurées par entité, quand la synchro planifiée s'exécute, alors seules les lignes dont le hash a changé sont écrites.

**US-M13-07 — En tant que gérant dont la base n'est pas accessible depuis internet, je veux installer un petit agent sur le PC du garage.**
- Étant donné que je télécharge l'agent et saisis le code d'appairage à 8 caractères affiché à l'écran, quand l'agent démarre, alors il apparaît « En ligne » dans `/import/sources`, lit la base locale et pousse les lignes vers l'API ; s'il est hors ligne depuis > 24 h, une alerte `import_stale` est levée (M12).

**US-M13-08 — En tant qu'intégrateur, je veux une API REST documentée afin de pousser les données du logiciel existant.**
- Étant donné une clé `ak_live_…` avec les scopes `customers:write invoices:write`, quand j'envoie `POST /api/v1/invoices` avec `Idempotency-Key: 6f1c…`, alors la facture est créée (201) ; un second envoi avec la même clé renvoie la même réponse sans doublon.
- Étant donné une clé sans `payments:write`, alors `POST /api/v1/payments` renvoie 403 `insufficient_scope`.

**US-M13-09 — En tant qu'intégrateur, je veux recevoir des webhooks signés.**
- Étant donné un endpoint abonné à `payment.received`, quand un paiement Wave est confirmé, alors un POST signé `X-AtelierOS-Signature` est envoyé ; en cas d'échec il est réessayé 8 fois sur 24 h puis l'endpoint est désactivé après 50 échecs consécutifs avec notification à l'OWNER.

**US-M13-10 — En tant que gérant, je veux migrer complètement vers AtelierOS.**
- Étant donné l'assistant `/import/migration`, quand j'ai importé clients, véhicules, pièces, factures ouvertes, historique OR et paiements, et que les contrôles de cohérence sont verts, alors je peux cliquer « Basculer en gestion complète » : `operatingMode = FULL`, les sources de synchro passent `isActive = false`, les séquences de numérotation démarrent après le dernier numéro importé.

## 4. Règles métier

### 4.1 Lecture des fichiers

- **RG-M13-01 — Formats.** `.xlsx`, `.xls`, `.csv`, `.txt` (délimité), taille max 20 Mo, 100 000 lignes. Bibliothèques : `exceljs` (xlsx), `xlsx` (xls), `papaparse` (csv). Fichier stocké en S3 `imports/{orgId}/{jobId}/source.ext`, conservé 90 jours.
- **RG-M13-02 — Encodage.** BOM UTF-8/UTF-16 respecté ; sinon test de décodage UTF-8 strict ; en cas d'échec → Windows-1252 (cas typique des exports Access/Excel français) ; si > 1 % de caractères `�` → ISO-8859-1. L'utilisateur peut forcer l'encodage.
- **RG-M13-03 — Séparateur CSV.** Candidats `;`, `,`, `\t`, `|` ; choisir celui qui donne le nombre de colonnes **le plus constant (> 1)** sur les 50 premières lignes ; à égalité `;` (Excel FR). Guillemets `"` gérés.
- **RG-M13-04 — En-tête et feuille.** Feuille = première feuille non vide (choix possible). Ligne d'en-tête = première ligne, parmi les 10 premières, dont ≥ 60 % des cellules sont du texte non numérique. Lignes entièrement vides ignorées ; lignes de total (« TOTAL », « Total général ») ignorées.

### 4.2 Correspondance des colonnes

- **RG-M13-05 — Normalisation des en-têtes.** minuscules, sans accents, ponctuation → espace, espaces multiples réduits (« Tél. Portable » → `tel portable`).
- **RG-M13-06 — Synonymes connus** (`core/import/synonyms.ts`, extrait) :

| Champ cible | Synonymes |
|---|---|
| `customer.displayName` | nom, nom prenoms, nom et prenoms, client, raison sociale, nom client, designation client |
| `customer.firstName` / `lastName` | prenom(s) / nom de famille, nom |
| `customer.phone` | telephone, tel, portable, cel, cellulaire, mobile, contact, numero, gsm |
| `customer.phone2` | tel 2, autre telephone, fixe, bureau |
| `customer.email` | email, e mail, courriel, mail |
| `customer.type` | type client, categorie, particulier entreprise |
| `customer.ncc` | ncc, compte contribuable, n cc, numero contribuable |
| `vehicle.plate` | immatriculation, immat, plaque, n immat, matricule |
| `vehicle.make` / `model` | marque / modele, type vehicule |
| `vehicle.vin` | vin, chassis, n chassis, numero de serie |
| `vehicle.inspectionExpiryDate` | date vt, expiration vt, fin visite, prochaine visite, validite vt |
| `vehicle.lastServiceDate` / `lastServiceMileage` | derniere revision, date vidange / km revision, km vidange |
| `vehicle.currentMileage` | km, kilometrage, compteur |
| `invoice.externalNumber` | n facture, numero facture, facture, ref facture, piece |
| `invoice.issuedAt` / `dueDate` | date facture, date / echeance, date echeance, date limite |
| `invoice.total` / `amountPaid` / `balance` | montant ttc, total, net a payer / regle, paye, verse / reste, reste a payer, solde, du |
| `payment.amount` / `method` / `receivedAt` | montant, encaisse / mode, mode reglement / date reglement |
| `product.sku` / `name` / `salePrice` / `onHand` | reference, code article / designation, libelle / prix vente, pv / stock, quantite, qte |

  Correspondance exacte après normalisation = confiance 1,0 ; inclusion d'un synonyme = 0,8 ; distance de Levenshtein ≤ 2 = 0,7.
- **RG-M13-07 — Aide IA.** Les colonnes restées < 0,7 sont envoyées à M17 (`ai.mapColumns`) avec l'en-tête et **5 valeurs d'exemple masquées** (chiffres de téléphone remplacés par `X` sauf les 2 premiers, noms tronqués à l'initiale). Proposition IA acceptée par défaut seulement si confiance ≥ 0,8, et toujours affichée en orange « Proposé par l'assistant » à confirmer. IA indisponible → colonnes laissées « à associer » sans bloquer.
- **RG-M13-08 — Mappings mémorisés.** Après un import réussi, le mapping est enregistré dans `DataSource.mapping` sous la **signature** de l'en-tête (`sha256` des en-têtes normalisés triés) ; un fichier de même signature est pré-associé à 100 %.
- **RG-M13-09 — Colonnes combinées.** Une colonne « Nom & Prénoms » alimente `displayName` ; si `type` absent, détection entreprise si le nom contient `SARL|SA|SAS|SASU|GIE|ETS|STE|SOCIETE|GROUPE|TRANSPORT|CI$` (insensible à la casse) → `COMPANY`. Une colonne « Véhicule » de la forme « Toyota Corolla » est découpée en marque (premier mot reconnu dans la liste des marques) et modèle.

### 4.3 Normalisation (fonctions de `core/import/normalize.ts`)

- **RG-M13-10 — Téléphone** via `core/phone` : retirer espaces, points, tirets, parenthèses ; `00225` → `+225` ; 10 chiffres commençant par `01|05|07|21|25|27` → `+225` + 10 chiffres ; **8 chiffres** (ancien plan d'avant 2021) → préfixe opérateur ajouté (07 Orange, 05 MTN, 01 Moov ; fixes 27/25/21) selon les 2 premiers chiffres d'après la table de migration ARTCI (`core/phone/legacy-ci.ts`, ex. `08 12 34 56` → `+225 07 08 12 34 56`), avec avertissement « Numéro à 8 chiffres converti » ; autre pays avec `+` conservé ; sinon erreur. Plusieurs numéros dans une cellule (« 0708123456 / 0505112233 ») → premier en `phone`, second en `phone2`.
- **RG-M13-11 — Dates.** Ordre d'essai : nombre de série Excel (1900) ; `jj/mm/aaaa`, `jj-mm-aaaa`, `jj.mm.aaaa`, `jj/mm/aa` (aa < 50 → 20aa) ; ISO `aaaa-mm-jj` ; textes « 2 nov. 2026 », « 02 novembre 2026 ». **Jamais** `mm/jj` sauf si l'utilisateur choisit explicitement « format américain ». Date hors [1990 ; aujourd'hui + 3 ans] → erreur.
- **RG-M13-12 — Montants.** Retirer `FCFA`, `F CFA`, `XOF`, `F`, espaces (y compris insécables U+00A0, U+202F), séparateurs de milliers `.` ou `,` lorsque suivis d'exactement 3 chiffres ; `185 000` → 185000 ; `185.000` → 185000 ; `185000,00` → 185000 ; décimales non nulles → arrondi à l'entier le plus proche + avertissement. Négatif `(185 000)` ou `-185 000` accepté seulement pour avoirs/paiements remboursés.
- **RG-M13-13 — Plaques** : majuscules, retirer tirets/points, espaces simples ; format CI moderne `^\d{4}\s?[A-Z]{2}\s?\d{2}$` reformaté `2547 GH 01` ; format WW / ancien / étranger accepté tel quel avec avertissement « Format de plaque non standard ».
- **RG-M13-14 — Textes** : trim, espaces multiples réduits ; noms en « Casse Titre » sauf si la cellule contient déjà des minuscules ; email en minuscules et validé.
- **RG-M13-15 — Énumérations** : mode de paiement (`espece|cash` → CASH, `wave` → WAVE, `om|orange` → ORANGE_MONEY, `mtn|momo` → MTN_MOMO, `moov|flooz` → MOOV_MONEY, `virement|vir` → BANK_TRANSFER, `cheque|chq` → CHEQUE, `cb|carte` → CARD, sinon OTHER) ; carburant (`essence|ess` → PETROL, `gasoil|gazole|diesel` → DIESEL…).

### 4.4 Validation ligne par ligne

- **RG-M13-16 — Règles obligatoires par entité** :

| Entité (`ImportJob.entity`) | Obligatoire | Contrôles |
|---|---|---|
| `customers` | `displayName` (ou nom + prénom) ; `phone` ou `email` | téléphone/email valides |
| `vehicles` | `plate` ; propriétaire (téléphone, n° client externe ou nom exact) ; `make` | `year` ∈ [1960 ; année+1] ; date VT valide |
| `invoices` | n° externe, client, `issuedAt`, `total` | `amountPaid ≤ total` ; `balance = total − amountPaid` (tolérance 1 FCFA) sinon erreur ; `dueDate ≥ issuedAt` |
| `payments` | n° facture externe ou client, `amount > 0`, `receivedAt` | facture existante (dans le fichier ou en base) |
| `products` | `sku`, `name` | prix ≥ 0 ; `onHand` entier |
| `repair_orders` (historique) | plaque, date, (n° externe) | km ≥ 0 |

  Sévérités : `ERROR` (ligne rejetée) et `WARNING` (ligne importée, signalée).
- **RG-M13-17 — Fichier multi-entités.** Un fichier « une ligne = un client + un véhicule + une facture » est accepté : l'import crée dans l'ordre clients → véhicules → factures → paiements, dans le même job (`entity = "mixed"`).

### 4.5 Dédoublonnage et mise à jour incrémentale

- **RG-M13-18 — Ordre de correspondance** :
  1. `ExternalRef (dataSourceId, entity, externalId)` si une colonne d'identifiant externe est mappée ;
  2. Client : `phone` E.164 identique (sur `phone`, `phone2`, `whatsappPhone`) ; sinon `email` ; sinon `ncc` pour COMPANY ; **jamais** sur le nom seul (proposé « doublon possible » si similarité trigram ≥ 0,8 et même commune) ;
  3. Véhicule : `plate` normalisée (non supprimé), puis `vin` ;
  4. Facture : `ExternalRef`, sinon `(customerId, externalNumber)` ;
  5. Paiement : `(provider, providerRef)` ou `(invoice, amount, receivedAt, reference)`.
  Doublons **dans le fichier** : la dernière ligne gagne, les précédentes sont marquées « fusionnée avec la ligne N ».
- **RG-M13-19 — Hash et changements.** `hash = sha256(JSON canonique des champs mappés normalisés)`. Si `ExternalRef.hash` identique → `unchanged` (pas d'écriture). Sinon mise à jour selon la **politique** du job : `CREATE_ONLY`, `UPSERT` (défaut ; champs vides du fichier **n'écrasent pas** une valeur existante), `UPSERT_OVERWRITE`. Champs jamais écrasés par import : `remindersConsent`, `optedOutAt`, `doNotRemind`, `preferredChannel` saisis dans AtelierOS.
- **RG-M13-20 — Factures importées.** Créées avec `origin = IMPORTED`, `status` déduit (balance 0 → PAID ; dueDate < aujourd'hui → OVERDUE ; sinon ISSUED), `number = null` (le n° du logiciel source va dans `externalNumber` et est utilisé dans les relances `{{facture.numero}}`), `fneStatus = NOT_REQUIRED` (la FNE relève du logiciel source), sans lignes si le fichier n'en contient pas. Le déjà-payé initial est matérialisé par un `Payment` `method = OTHER`, `reference = "OPENING"`, `origin = IMPORTED` (exclu des encaissements M12). Une facture importée peut être mise à jour (montants) tant que `origin = IMPORTED` ; elle n'est pas « émise » au sens de M08.
- **RG-M13-21 — Baisse de solde.** Si le solde importé diminue de Δ : création d'un `Payment` de reprise (`reference = "IMPORT-SOLDE"`, `receivedAt` = date du fichier ou date de paiement si mappée) alloué de Δ, ce qui déclenche `payment.received`. Solde qui **augmente** → erreur « Le solde de FAC… a augmenté (avoir annulé ?) : vérifiez dans votre logiciel » (sauf `UPSERT_OVERWRITE`).
- **RG-M13-22 — Disparition.** Une facture ouverte absente d'un import **complet** (case « Ce fichier contient toutes les factures impayées ») est passée `PAID` par paiement de reprise uniquement si l'utilisateur coche « Considérer les factures absentes comme réglées » (défaut décoché ; aperçu de la liste obligatoire).
- **RG-M13-23 — Simulation (`dryRun`).** Exécute tout le pipeline dans une transaction **annulée** (rollback) ; produit les compteurs `create / update / unchanged / skip / error` et un échantillon de 20 changements (avant → après). Une simulation est obligatoire avant le premier import d'une source.
- **RG-M13-24 — Exécution.** Lots de 500 lignes, une transaction par lot ; progression publiée toutes les 2 s (`ImportJob.processedRows`) ; reprise possible à partir du dernier lot validé. Après import : émission de `vehicle.inspection_updated` / `vehicle.mileage_recorded` / `invoice.issued` (avec `payload.origin = "IMPORTED"`) pour que M10 planifie les relances. Annulation d'un import (`imports.rollback`) possible pendant 7 jours si aucun enregistrement créé n'a été modifié depuis (sinon refus listant les conflits).

### 4.6 Connexion directe et agent local

- **RG-M13-25 — Bases supportées** : SQL Server (`mssql`), MySQL/MariaDB (`mysql2`), PostgreSQL (`pg`), Firebird (`node-firebird`) ; **Access** : uniquement via l'agent local (pilote ODBC Windows) ou export CSV planifié vers dossier surveillé. Connexion **lecture seule** : l'utilisateur fourni doit être en lecture seule (vérifié : tentative `CREATE TEMPORARY TABLE` rejetée ou avertissement « Ce compte a des droits d'écriture ; créez un compte en lecture seule »). Requêtes analysées : uniquement **un seul** `SELECT` / `WITH … SELECT` (parseur `node-sql-parser`) ; mots-clés `INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|MERGE|GRANT|;` refusés. Timeout 60 s, 50 000 lignes max par requête.
- **RG-M13-26 — Requêtes configurables** par entité avec paramètre `:since` (horodatage de la dernière synchro réussie − 1 jour de recouvrement) et colonne `externalId` obligatoire. Exemple SQL Server :
  ```sql
  SELECT f.NumFact AS externalId, f.CodeClient AS customerExternalId, f.DateFact AS issuedAt,
         f.Echeance AS dueDate, f.MontantTTC AS total, f.MontantRegle AS amountPaid
  FROM Factures f WHERE f.DateModif >= :since OR f.MontantTTC > f.MontantRegle
  ```
- **RG-M13-27 — Planification** : `DataSource.schedule` (cron, min toutes les 15 min, défaut `0 2 * * *` heure locale). La tâche `imports.watch` (toutes les 15 min) déclenche les sources dues, verrou par source, retries ×3 (1, 5, 15 min). Résultat → `DataSource.lastRunAt/lastStatus` ; 3 échecs consécutifs → notification OWNER.
- **RG-M13-28 — Agent local** (`apps/sync-agent`, Node, empaqueté en exécutable Windows par `@yao-pkg/pkg`, service Windows via `node-windows`) :
  - Appairage : l'OWNER génère un code (8 caractères, valable 15 min) → l'agent l'échange contre un jeton `SyncAgent` (scope `sync:push`) stocké chiffré par DPAPI Windows.
  - Il télécharge sa configuration (requêtes, planning, dossier surveillé) via `GET /api/v1/sync/config`, exécute les requêtes **localement**, calcule le hash par ligne, garde un cache local SQLite des hash et **n'envoie que les lignes changées** par `POST /api/v1/sync/batches` (lots de 500, gzip, `Idempotency-Key = sha256(batch)`).
  - Connexion **sortante uniquement** (HTTPS 443) ; aucune ouverture de port. Battement `POST /api/v1/sync/heartbeat` toutes les 5 min (version, dernière exécution, erreurs). Mise à jour automatique signée.
  - File locale si internet coupé, renvoi au retour du réseau (rétention 7 jours).
- **RG-M13-29 — Dossier surveillé** : SFTP hébergé par AtelierOS (identifiants par organisation) ou dossier local de l'agent. Fichiers stables depuis 60 s ; motif de nom configurable (`*.csv`) ; un fichier déjà traité (même sha256) est ignoré ; déplacé vers `traites/AAAA-MM-JJ/` ou `erreurs/`.

### 4.7 API REST publique

- **RG-M13-30 — Authentification** : `Authorization: Bearer ak_live_<32 car. base62>` ; stockage `sha256` dans `ApiKey.keyHash`, préfixe affiché `ak_live_3f9a…` ; clé visible **une seule fois** à la création ; clés `ak_test_` liées au mode bac à sable (adaptateurs `console`). `lastUsedAt` mis à jour au plus 1 fois/min.
- **RG-M13-31 — Scopes** : `customers:read|write`, `vehicles:read|write`, `invoices:read|write`, `payments:read|write`, `products:read|write`, `repair_orders:read|write`, `appointments:read|write`, `quotes:read`, `reminders:read`, `reports:read`, `webhooks:manage`, `sync:push`. `write` n'implique pas `read`.
- **RG-M13-32 — Pagination** par curseur : `?limit=50` (max 200) `&cursor=…` ; réponse `{ data: [], next_cursor: string|null }`. Filtres `updated_since` (ISO 8601) sur toutes les listes.
- **RG-M13-33 — Idempotence** : `Idempotency-Key` (≤ 255 car.) **obligatoire** sur tous les POST ; conservée 24 h avec le hash du corps et la réponse ; même clé + corps différent → 422 `idempotency_key_reused`.
- **RG-M13-34 — Rate-limit** par clé (Redis, fenêtre glissante) : STARTER 60 req/min, PRO 300, NETWORK 1 200 ; en-têtes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` ; dépassement → 429 + `Retry-After`.
- **RG-M13-35 — Format** : JSON `snake_case`, montants entiers FCFA, dates `AAAA-MM-JJ`, horodatages ISO 8601 UTC, téléphones E.164 (saisie tolérante normalisée). Erreurs : `{ "error": { "code": "validation_failed", "message": "Téléphone invalide", "details": [{ "field": "phone", "issue": "…" }] } }`. Codes : 400, 401 `invalid_api_key`, 403 `insufficient_scope`, 404, 409 `conflict`, 422, 429, 500. Version : `/api/v1` ; changements cassants → `/api/v2`, préavis 6 mois.
- **RG-M13-36 — `external_id`** : tous les POST/PATCH acceptent `external_id` (+ `source`, défaut = nom de la clé API) qui crée/maj un `ExternalRef` ; `PUT /api/v1/{ressource}/by-external-id/{external_id}` fait un upsert.
- **RG-M13-37 — Liste des endpoints** (spécification OpenAPI 3.1 générée depuis les schémas Zod par `zod-openapi`, servie à `/api/v1/openapi.json`, documentation lisible `/api/docs` (Scalar)) :

| Méthode et chemin | Scope | Description |
|---|---|---|
| `GET /api/v1/customers` · `GET /api/v1/customers/{id}` | customers:read | Liste (filtres `phone`, `updated_since`) / détail |
| `POST /api/v1/customers` · `PATCH /api/v1/customers/{id}` · `PUT /api/v1/customers/by-external-id/{eid}` | customers:write | Créer / modifier / upsert |
| `GET /api/v1/customers/{id}/balance` | invoices:read | Solde dû, factures ouvertes |
| `GET /api/v1/vehicles` · `GET /api/v1/vehicles/{id}` | vehicles:read | Filtres `plate`, `customer_id`, `inspection_expiry_before` |
| `POST /api/v1/vehicles` · `PATCH /api/v1/vehicles/{id}` · `PUT …/by-external-id/{eid}` | vehicles:write | |
| `POST /api/v1/vehicles/{id}/mileage-readings` | vehicles:write | Relevé km (`source = IMPORT`) |
| `GET /api/v1/invoices` · `GET /api/v1/invoices/{id}` | invoices:read | Filtres `status`, `customer_id`, `due_before` |
| `POST /api/v1/invoices` · `PATCH /api/v1/invoices/{id}` · `PUT …/by-external-id/{eid}` | invoices:write | Factures externes (`origin = API`) ; PATCH refusé sur facture émise par AtelierOS (409) |
| `GET /api/v1/payments` · `POST /api/v1/payments` | payments:read / write | Paiement + `allocations[]` |
| `GET /api/v1/products` · `POST` · `PATCH /api/v1/products/{id}` | products:read / write | Stock en lecture seule (`on_hand` par site) |
| `GET /api/v1/repair-orders` · `GET /api/v1/repair-orders/{id}` · `POST` | repair_orders:read / write | `POST` = historique externe (`origin = API`) |
| `GET /api/v1/appointments` · `POST /api/v1/appointments` · `PATCH …/{id}` | appointments:read / write | |
| `GET /api/v1/quotes` · `GET /api/v1/quotes/{id}` | quotes:read | |
| `GET /api/v1/reminders` | reminders:read | Relances et outcome |
| `GET /api/v1/reports/kpis` | reports:read | Indicateurs M12 |
| `GET/POST /api/v1/webhook-endpoints` · `PATCH/DELETE …/{id}` · `POST …/{id}/test` | webhooks:manage | |
| `POST /api/v1/imports` (multipart) · `GET /api/v1/imports/{id}` | customers:write… selon entité | Import fichier par API |
| `GET /api/v1/sync/config` · `POST /api/v1/sync/batches` · `POST /api/v1/sync/heartbeat` | sync:push | Agent local |
| `GET /api/v1/me` | — | Organisation, scopes, limites de la clé |

### 4.8 Webhooks sortants

- **RG-M13-38 — Événements** : `customer.created|updated`, `vehicle.created|updated`, `invoice.issued|voided|paid`, `payment.received`, `repair_order.status_changed`, `quote.accepted|declined`, `appointment.created|cancelled`, `reminder.sent`, `import.completed`. Corps : `{ id: "evt_…", type, created_at, organization_id, data: {…} }`.
- **RG-M13-39 — Signature** : `X-AtelierOS-Signature: t=1760774400,v1=<hex HMAC-SHA256(secret, t + "." + corps)>` ; le destinataire rejette si `|now − t| > 300 s`. Secret `whsec_…` (32 octets) stocké chiffré, rotation avec 24 h de double signature (`v1=…,v1=…`).
- **RG-M13-40 — Livraison** : timeout 10 s, succès = 2xx ; retries à 1 min, 5 min, 30 min, 2 h, 5 h, 10 h, 24 h (8 tentatives) ; 50 échecs consécutifs → `isActive = false` + notification. Ordre non garanti ; `id` d'événement pour l'idempotence côté destinataire. URL `https` obligatoire, IP privées refusées (anti-SSRF).

### 4.9 Migration complète

- **RG-M13-41 — Assistant de migration** (`/import/migration`), étapes ordonnées : 1. Clients ; 2. Véhicules ; 3. Pièces + stock initial (mouvement `ADJUSTMENT` motif « Stock initial ») ; 4. Historique OR (`origin = IMPORTED`, statut `INVOICED`, sans pointages) ; 5. Factures (ouvertes et historiques 24 mois) ; 6. Paiements ; 7. Contrôles ; 8. Bascule.
- **RG-M13-42 — Contrôles avant bascule** (bloquants) : total des soldes clients importés = total fourni par l'utilisateur (saisi depuis l'ancien logiciel, tolérance 0 FCFA) ; 0 véhicule sans propriétaire ; valeur de stock = valeur saisie (± 1 %) ; aucune source en erreur. Non bloquants : clients sans téléphone, véhicules sans date VT.
- **RG-M13-43 — Bascule FULL** : `Organization.operatingMode = FULL` ; `DocumentSequence.lastValue` initialisé pour l'année en cours au dernier numéro de l'ancien logiciel si le format est repris (`FAC-2026-000123`), sinon séquence neuve ; sources `SQL_DATABASE`/`WATCHED_FOLDER` désactivées ; `AuditLog` action `org.operating_mode_changed` avec motif. Retour à REMINDERS_ONLY possible pendant 30 jours si aucune facture n'a été émise dans AtelierOS.

## 5. Machine à états

`ImportJob.status` : `PENDING` (fichier reçu) → `VALIDATING` (lecture, mapping, validation) → `READY` (simulation disponible, attente de confirmation) → `RUNNING` → `COMPLETED` | `FAILED`. `VALIDATING → FAILED` si fichier illisible. `READY → CANCELLED` (§14) par l'utilisateur ou après 24 h. `COMPLETED → ROLLED_BACK` (§14) via `imports.rollback`. Un job de source planifiée passe directement `VALIDATING → RUNNING` si le mapping est mémorisé et `autoApply = true`.
`SyncAgent.status` : `PAIRING → ONLINE ↔ OFFLINE` (pas de battement depuis 15 min) → `REVOKED`.

## 6. Données

`DataSource`, `ImportJob`, `ImportRowError`, `ExternalRef`, `ApiKey`, `WebhookEndpoint`, `Customer`, `Vehicle`, `MileageReading`, `Invoice`, `Payment`, `PaymentAllocation`, `Product`, `StockMovement`, `RepairOrder`, `DocumentSequence`, `Organization.operatingMode`, `AuditLog`, `AiInteraction`. Ajouts en §14 : `SyncAgent`, `WebhookDelivery`, `IdempotencyKey`, champs `origin`/`externalNumber`, compléments `ImportJob`/`ImportRowError`/`ApiKey`/`WebhookEndpoint`.
`DataSource.config` (chiffré) : `{ dbType, host, port, database, user, password, ssl, queries: { customers: "SELECT…", … }, folderPath, filePattern, sftpUser, agentId }`. `DataSource.mapping` : `{ [headerSignature]: { entity, columns: { "Tél.": "customer.phone" }, options: { dateFormat, policy } } }`.

## 7. Écrans et interface

- **`/import`** — 3 grandes cartes (Fichier Excel/CSV · Synchronisation automatique · Saisie manuelle → liens `/clients/nouveau`…), carte « Migrer complètement » (visible en REMINDERS_ONLY), historique des imports (date, source, entité, lignes créées/maj/inchangées/erreurs, statut, auteur, « Rapport », « Annuler l'import »).
- **`/import/fichier`** — Stepper : 1. **Déposer** (glisser-déposer, choix de l'entité ou « Détection auto », liens « Télécharger le modèle ») ; 2. **Lecture** (encodage, séparateur, feuille, ligne d'en-tête modifiables) ; 3. **Correspondance** (gauche : colonne du fichier + 3 exemples ; droite : menu déroulant des champs groupés par entité ; pastille confiance ; options format de date et politique de mise à jour) ; 4. **Vérification** (aperçu 50 lignes, cellules en erreur rouges / avertissements orange, correction inline, filtres « Erreurs seulement ») ; 5. **Simulation** (compteurs, échantillon avant→après) ; 6. **Import** (barre de progression temps réel, possible de quitter la page) ; 7. **Résumé** (« 412 clients, 538 véhicules, 96 factures importés — 7 lignes ignorées », « Télécharger le rapport d'erreurs », « Voir les relances planifiées »). Mobile : étapes 1, 5–7 seulement ; correspondance sur PC recommandée (bandeau).
- **`/import/sources`** — Liste des sources (type, nom, planning, dernière exécution, statut, prochaine exécution), bouton « Nouvelle source ». **`/import/sources/[id]`** : formulaire selon type (base : type, hôte, port, base, utilisateur, mot de passe masqué « •••• enregistré », SSL ; « Tester la connexion » ; éditeur de requêtes par entité avec « Prévisualiser 20 lignes » ; mapping ; planning en langage simple « Tous les jours à 02:00 ») ; journal des 30 dernières exécutions.
- **`/import/agent`** — Téléchargement de l'agent (Windows 10+), code d'appairage, état des agents (En ligne / Hors ligne depuis…), version, dernière synchro, « Révoquer ».
- **`/import/migration`** — Checklist des 8 étapes avec état, contrôles, bouton « Basculer en gestion complète » (confirmation tapée « BASCULER »).
- **`/parametres/api`** (rendu dans M15) — clés API (nom, préfixe, scopes, dernière utilisation, révoquer), webhooks (URL, événements, statut, livraisons récentes avec code HTTP, « Renvoyer », « Envoyer un test »), lien documentation.

## 8. API

| Procédure tRPC | Entrée | Sortie |
|---|---|---|
| `imports.upload` | `{ fileName, size, mimeType }` | `{ jobId, uploadUrl }` (URL S3 signée) |
| `imports.analyze` | `{ jobId, encoding?, delimiter?, sheet?, headerRow? }` | `{ headers, samples, detected: {encoding, delimiter}, suggestedEntity, mapping: [{column, field, confidence, source: 'synonym'\|'ai'\|'memory'}] }` |
| `imports.setMapping` | `{ jobId, entity, columns, options: {policy, dateFormat, treatMissingAsPaid} }` | `{ ok }` |
| `imports.validate` | `{ jobId, cursor? }` | `{ rows: [{rowNumber, values, issues[]}], counts }` |
| `imports.patchRow` | `{ jobId, rowNumber, field, value }` | `{ issues[] }` |
| `imports.simulate` | `{ jobId }` | `{ create, update, unchanged, skip, error, sample[] }` |
| `imports.run` | `{ jobId, skipErrors: boolean }` | `{ status }` |
| `imports.progress` | `{ jobId }` | `{ status, processedRows, totalRows, counts }` (polling 2 s) |
| `imports.errorReport` | `{ jobId }` | `{ url }` (.xlsx signé 15 min) |
| `imports.rollback` | `{ jobId, reason }` | `{ reverted, conflicts[] }` |
| `imports.list` | `{ cursor? }` | historique |
| `imports.template` | `{ entity }` | `{ url }` |
| `dataSources.list/get/create/update/delete` | `DataSourceInput` (secrets en écriture seule) | `DataSource` sans secrets |
| `dataSources.test` | `{ id }` ou config | `{ ok, tables?, error? }` |
| `dataSources.previewQuery` | `{ id, entity, sql }` | `{ columns, rows (20) }` |
| `dataSources.runNow` | `{ id }` | `{ jobId }` |
| `syncAgents.createPairingCode` / `list` / `revoke` | — / — / `{ id }` | `{ code, expiresAt }` / agents / `{ ok }` |
| `migration.status` / `migration.check` / `migration.switchToFull` | — / `{ expectedReceivables, expectedStockValue }` / `{ confirm: "BASCULER", reason }` | état / contrôles / `{ ok }` |
| `apiKeys.list` / `create` / `revoke` | — / `{ name, scopes[], expiresAt? }` / `{ id }` | — / `{ key (une fois), prefix }` / `{ ok }` |
| `webhooks.list` / `create` / `update` / `delete` / `test` / `deliveries` / `redeliver` | … | … |

REST : §4.7.

## 9. Automatisations et événements

- Files BullMQ : `imports` (analyse, validation, exécution, rollback), `sync` (requêtes base, dossier surveillé, lots de l'agent), `webhooks` (livraisons).
- Tâches : `imports.watch` (15 min), `sync.agents_health` (5 min → `OFFLINE`), `idempotency.purge` (horaire), `imports.cleanup` (quotidienne : fichiers > 90 j, jobs `READY` > 24 h → `CANCELLED`).
- Émis : `import.completed`, `import.failed`, et événements métier standards (`vehicle.inspection_updated`, `vehicle.mileage_recorded`, `invoice.issued`, `payment.received`) avec `payload.origin`.
- Consommés (pour webhooks sortants) : tous les événements de RG-M13-38 via un abonné générique `webhooks.fanout`.

## 10. Permissions

| Action | Permission | Rôles par défaut |
|---|---|---|
| Importer un fichier, simuler, voir l'historique, télécharger rapports et modèles | `import:run` | OWNER, MANAGER, ACCOUNTANT |
| Annuler un import | `import:run` + être l'auteur, ou OWNER | |
| Sources de synchro, agent local, clés API, webhooks | `integration:manage` | OWNER |
| Bascule FULL / retour REMINDERS_ONLY | `org:update` | OWNER |
| Importer des factures/paiements | `import:run` + `invoice:create` / `payment:create` | OWNER, ACCOUNTANT |

API publique : scopes de la clé (RG-M13-31), toujours bornés à l'organisation de la clé ; la clé n'a **aucune** restriction de site sauf `ApiKey.siteIds` (§14).

## 11. Cas limites et erreurs

- Fichier protégé par mot de passe → « Ce fichier est protégé. Enregistrez-le sans mot de passe puis réessayez. »
- Cellules fusionnées / en-tête sur 2 lignes → choix manuel de la ligne d'en-tête ; valeurs fusionnées recopiées vers le bas.
- Même téléphone pour deux clients différents du fichier (ex. secrétaire d'une entreprise) → avertissement « Téléphone partagé par 2 clients », pas de fusion automatique si les noms diffèrent (similarité < 0,5) : second client créé sans téléphone + avertissement.
- Véhicule dont la plaque existe chez un autre client → `WARNING` « Plaque déjà rattachée à Kouassi Jean-Marc » ; propriétaire modifié seulement en `UPSERT_OVERWRITE` (+ `VehicleEvent` « changement de propriétaire »).
- Date VT déjà passée de plus de 2 ans → importée, avertissement « VT expirée depuis longtemps : relance non planifiée » (M10 ignore au-delà de 90 jours d'expiration).
- Import massif (> 5 000 relances qui deviendraient dues) → M10 les planifie en `NEEDS_APPROVAL` avec bandeau « Premier import : vérifiez les relances avant envoi » (aucun envoi automatique dans les 24 h suivant un premier import).
- Base externe : timeout → « La requête a dépassé 60 s : ajoutez un filtre :since » ; identifiants invalides → « Identifiants refusés par la base » (jamais le message brut contenant l'hôte et l'utilisateur dans les logs côté client).
- Agent avec horloge décalée > 5 min → lots acceptés, avertissement dans `/import/agent`.
- Clé API révoquée en cours d'utilisation → 401 immédiat (cache des clés ≤ 30 s).
- Webhook vers `http://` ou `192.168.x.x` → refus « URL HTTPS publique requise ».

## 12. Tests

- **Unitaires `core/import`** : détection encodage (fixtures UTF-8, UTF-8 BOM, Windows-1252 « Côte d'Ivoire »), séparateur, ligne d'en-tête ; tous les cas de RG-M13-10 à 15 (`0708123456`, `07 08 12 34 56`, `00225…`, `+33…`, 8 chiffres ; `02/11/2026`, `45963` série Excel, `2 nov. 2026`, `11/02/26` ; `185 000`, `185.000`, `185 000 FCFA`, `185000,50`) ; synonymes ; hash canonique ; dédoublonnage (fichier et base) ; RG-M13-21/22 ; parseur SQL lecture seule (requêtes piégées `SELECT 1; DROP TABLE`).
- **Intégration** : import `tests/fixtures/import-garage.xlsx` (412 clients, 538 véhicules, 96 factures, 7 erreurs) → compteurs exacts ; réimport identique → 0 écriture ; dryRun sans écriture ; rollback ; API : scopes, idempotence, rate-limit, pagination, isolation multi-locataire (clé de A sur ressource de B → 404) ; signature webhook et retries ; PostgreSQL de test comme base externe.
- **E2E Playwright** : premier import (déposer → mapping → 2 erreurs corrigées → simulation → import → résumé → relances planifiées visibles).

## 13. Définition de « terminé »

- [ ] Pipeline fichier complet (7 étapes UI) avec simulation, rapport d'erreurs, modèles pour les 6 entités.
- [ ] Synonymes + aide IA + mémorisation des mappings.
- [ ] Mise à jour incrémentale par hash, politiques, rollback.
- [ ] Sources planifiées : dossier surveillé, SQL Server/MySQL/PostgreSQL/Firebird, agent local appairé.
- [ ] API `/api/v1` conforme à RG-M13-30 à 37, OpenAPI publié, documentation `/api/docs`.
- [ ] Webhooks signés avec retries et journal de livraisons.
- [ ] Assistant de migration et bascule FULL auditée.
- [ ] Tests ci-dessus verts ; secrets jamais renvoyés au front ni journalisés.

## 14. Évolutions du modèle de données

```prisma
enum RecordOrigin { NATIVE IMPORTED API SYNC }

// Ajouts à Invoice
//   origin          RecordOrigin @default(NATIVE)
//   externalNumber  String?            // n° dans le logiciel source, affiché et utilisé dans les relances
// Ajouts à Payment, RepairOrder, Customer, Vehicle
//   origin          RecordOrigin @default(NATIVE)

// Compléments ImportJob
//   entity        : ajouter les valeurs "repair_orders" et "mixed"
//   fileName      String?
//   encoding      String?
//   delimiter     String?
//   headerSignature String?
//   mapping       Json   @default("{}")
//   policy        ImportPolicy @default(UPSERT)
//   processedRows Int    @default(0)
//   unchangedCount Int   @default(0)
//   warningCount  Int    @default(0)
//   summary       Json?               // échantillon avant/après de la simulation
//   errorReportUrl String?
//   rolledBackAt  DateTime?
enum ImportPolicy { CREATE_ONLY UPSERT UPSERT_OVERWRITE }
// ImportStatus : ajouter CANCELLED et ROLLED_BACK

// Compléments ImportRowError
//   severity  String @default("ERROR")   // ERROR | WARNING

// Compléments ExternalRef
//   importJobId  String?                 // dernier job ayant écrit (rollback)
//   lastSeenAt   DateTime?

model SyncAgent {
  id             String   @id @default(cuid())
  organizationId String
  dataSourceId   String?
  name           String                  // "PC Comptabilité"
  tokenHash      String   @unique
  status         String   @default("PAIRING")   // PAIRING | ONLINE | OFFLINE | REVOKED
  version        String?
  hostname       String?
  lastSeenAt     DateTime?
  lastError      String?
  pairingCode    String?  @unique
  pairingExpiresAt DateTime?
  createdAt      DateTime @default(now())
  revokedAt      DateTime?
}

// Compléments ApiKey
//   createdById  String?
//   expiresAt    DateTime?
//   siteIds      String[]               // vide = tous les sites
//   environment  String @default("live") // live | test

// Compléments WebhookEndpoint
//   description         String?
//   consecutiveFailures Int @default(0)
//   disabledAt          DateTime?
//   createdAt           DateTime @default(now())

model WebhookDelivery {
  id             String   @id @default(cuid())
  organizationId String
  endpointId     String
  eventId        String
  eventType      String
  attempt        Int      @default(1)
  status         String                  // PENDING | SUCCEEDED | FAILED
  responseCode   Int?
  responseBody   String?                 // tronqué à 2 Ko
  nextAttemptAt  DateTime?
  createdAt      DateTime @default(now())
  @@index([endpointId, createdAt])
}

model IdempotencyKey {
  id             String   @id @default(cuid())
  organizationId String
  apiKeyId       String
  key            String
  requestHash    String
  responseStatus Int
  responseBody   Json
  expiresAt      DateTime
  @@unique([apiKeyId, key])
}
```
