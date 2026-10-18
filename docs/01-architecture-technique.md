# 01 — Architecture technique

> Choix de stack, structure du code, conventions et règles transverses. Toute l'équipe (humaine ou agent IA) les respecte. Utiliser la **dernière version stable** de chaque outil au moment de l'initialisation, et figer les versions dans le lockfile.

---

## 1. Stack retenue et pourquoi

| Couche | Choix | Raison |
|---|---|---|
| Langage | **TypeScript** strict partout | Un seul langage front/back/worker, typage de bout en bout, excellent avec les agents IA |
| Monorepo | **pnpm workspaces + Turborepo** | Partage des types, du domaine et de l'UI entre web et worker |
| Application web | **Next.js (App Router)** + React Server Components | SSR rapide sur réseau lent, routes API, un seul déploiement |
| API interne | **tRPC** (front ↔ back) | Typage de bout en bout sans générer de client |
| API publique | **REST + OpenAPI** (route handlers Next.js, `/api/v1/*`) | Intégration avec le logiciel existant du garage et partenaires |
| Base de données | **PostgreSQL** | Fiable, transactions, JSONB, recherche plein texte, `pg_trgm` pour la recherche floue de plaques/noms |
| ORM | **Prisma** | Schéma lisible, migrations, très bien maîtrisé par les agents IA |
| Validation | **Zod** | Schémas partagés front/back/API |
| Files de tâches | **BullMQ + Redis** | Relances planifiées, envois, imports, synchronisations, retries |
| Authentification | **Better Auth** (email/téléphone + mot de passe, OTP SMS/WhatsApp, sessions) | Auto-hébergé, organisations et rôles |
| UI | **Tailwind CSS + shadcn/ui + Radix**, icônes **Lucide** | Composants accessibles et modifiables |
| Tableaux | **TanStack Table** | Tri, filtres, sélection, pagination serveur |
| Formulaires | **React Hook Form + Zod** | |
| Graphiques | **Recharts** | |
| Calendrier/planning | **FullCalendar** (vue ressources) ou composant maison sur `@dnd-kit` | Glisser-déposer des RDV sur les ponts |
| PDF | **@react-pdf/renderer** | Devis, OR, factures, reçus |
| Fichiers | Stockage **compatible S3** (MinIO en local, Cloudflare R2 ou S3 en prod) | Photos de réception, signatures, pièces jointes |
| PWA / hors-ligne | **Serwist** (service worker) + **Dexie** (IndexedDB) | Tablette mécanicien hors-ligne |
| E-mails | **Resend** ou SMTP (Nodemailer) + **React Email** | |
| WhatsApp | **WhatsApp Cloud API (Meta)** ; mode « lien wa.me » sans API | |
| SMS | Adaptateurs : **Orange SMS API (CI)**, **Twilio**, fournisseur générique HTTP | Le garage choisit selon prix et couverture |
| Paiement mobile | Adaptateurs : **CinetPay** (agrégateur Wave/Orange/MTN/Moov/carte), **Wave Business API** en direct | Lien de paiement + webhook |
| FNE (DGI) | Adaptateur `fne` (API DGI) avec mode « saisie manuelle du n° FNE » en secours | Obligation fiscale |
| IA | **API Claude (Anthropic)** via un service `ai` interne | Assistant, rédaction, extraction, prédictions |
| Observabilité | **Sentry** (erreurs), **pino** (logs JSON), **OpenTelemetry** optionnel | |
| Tests | **Vitest** (unitaires/intégration), **Playwright** (E2E), **Testcontainers** ou base Postgres de test | |
| Qualité | ESLint, Prettier, `tsc --noEmit`, Husky + lint-staged | |
| Déploiement | **Docker Compose** sur VPS (web, worker, postgres, redis, minio, caddy) ; alternative Vercel + Neon + Upstash | |

## 2. Structure du dépôt

```
atelieros/
├── apps/
│   ├── web/                    # Next.js : back-office, portail client, API publique
│   │   ├── app/
│   │   │   ├── (auth)/         # connexion, mot de passe, invitation
│   │   │   ├── (app)/          # back-office authentifié
│   │   │   │   ├── tableau-de-bord/
│   │   │   │   ├── rendez-vous/
│   │   │   │   ├── ordres/            # OR
│   │   │   │   ├── devis/
│   │   │   │   ├── atelier/           # planning, tâches, pointage
│   │   │   │   ├── clients/
│   │   │   │   ├── vehicules/
│   │   │   │   ├── stock/
│   │   │   │   ├── achats/
│   │   │   │   ├── factures/
│   │   │   │   ├── caisse/
│   │   │   │   ├── creances/
│   │   │   │   ├── relances/
│   │   │   │   ├── messages/          # boîte de réception
│   │   │   │   ├── rapports/
│   │   │   │   ├── import/
│   │   │   │   └── parametres/
│   │   │   ├── (tech)/         # PWA mécanicien (layout tablette)
│   │   │   ├── p/[token]/      # portail client public (devis, facture, suivi, paiement)
│   │   │   └── api/
│   │   │       ├── trpc/[trpc]/
│   │   │       ├── v1/...      # API REST publique
│   │   │       └── webhooks/   # whatsapp, sms, paiements, fne
│   │   └── server/
│   │       ├── routers/        # routeurs tRPC par module
│   │       └── context.ts
│   └── worker/                 # Processus BullMQ : planification, envois, imports, IA
│       └── src/
│           ├── queues/
│           ├── jobs/
│           └── schedulers/
├── packages/
│   ├── db/                     # schema.prisma, migrations, seed, client Prisma étendu (tenant)
│   ├── core/                   # LOGIQUE MÉTIER PURE (aucun import Next/Prisma direct)
│   │   ├── money/              # calculs FCFA, TVA, remises, arrondis
│   │   ├── reminders/          # calcul des échéances, paliers, dédoublonnage
│   │   ├── receivables/        # ancienneté, scoring, allocation des paiements
│   │   ├── inventory/          # CMP, réservations, seuils
│   │   ├── numbering/          # numérotation des documents
│   │   ├── phone/              # normalisation +225
│   │   └── ...
│   ├── integrations/           # adaptateurs externes derrière des interfaces
│   │   ├── messaging/          # whatsapp-cloud, wa-link, orange-sms, twilio-sms, smtp, resend, console
│   │   ├── payments/           # cinetpay, wave, manual
│   │   ├── fne/                # dgi-api, manual
│   │   ├── storage/            # s3
│   │   └── ai/                 # claude
│   ├── validators/             # schémas Zod partagés
│   ├── ui/                     # composants partagés (shadcn étendus, StatusBadge, MoneyInput…)
│   ├── pdf/                    # gabarits PDF
│   ├── emails/                 # gabarits React Email
│   └── config/                 # eslint, tsconfig, tailwind
├── docs/                       # ces PRD
├── docker/                     # Dockerfiles, compose, Caddyfile
├── CLAUDE.md                   # règles pour Claude Code
└── .cursor/rules/              # règles pour Cursor
```

**Règle d'or :** la logique métier vit dans `packages/core` sous forme de **fonctions pures testées**. Les routeurs tRPC, les jobs et l'API REST ne font qu'orchestrer : valider (Zod) → vérifier les droits → charger → appeler `core` → persister → émettre des événements.

## 3. Multi-locataire (multi-garages)

- Chaque table métier porte `organizationId` (et `siteId` quand c'est lié à un atelier physique).
- Le client Prisma est **étendu** (`packages/db/tenant.ts`) : toute requête passe par `db.forTenant(ctx)` qui injecte automatiquement `organizationId` dans les `where`, `create` et `update`. Une requête sans contexte locataire lève une erreur.
- Ceinture et bretelles : **Row Level Security PostgreSQL** activée sur les tables métier, avec `SET app.organization_id` par transaction.
- Test obligatoire : un utilisateur d'une organisation A ne peut lire, modifier ni deviner (énumération d'ID) aucune donnée de B.
- Identifiants : **cuid2** (non séquentiels) pour toutes les clés primaires. Les numéros lisibles (OR-2026-00042) sont des colonnes séparées.

## 4. Permissions (RBAC)

- Permissions fines sous forme `module:action` (ex. `invoice:create`, `invoice:void`, `receivable:writeoff`, `stock:adjust`, `settings:channels`).
- Chaque rôle (voir 00 §4) a un jeu par défaut, modifiable par l'`OWNER` (M15).
- Restriction par site : un membre peut être limité à certains sites.
- Vérification **côté serveur** systématique (middleware tRPC `requirePermission`). Le front masque seulement.
- Actions sensibles (annuler une facture, passer en perte, ajuster le stock, modifier un prix sous le minimum, supprimer) : permission dédiée + motif obligatoire + audit.

## 5. Événements de domaine

Bus interne simple (table `DomainEvent` + file BullMQ `events`) pour découpler les modules :

| Événement | Émis par | Consommé par |
|---|---|---|
| `vehicle.mileage_recorded` | M02, M04 | M10 (recalcul révision), M17 (km moyen) |
| `vehicle.inspection_updated` | M02, M04 | M10 (VT) |
| `appointment.created/updated/cancelled` | M03 | M10 (rappel RDV), M11 |
| `repair_order.status_changed` | M04 | M11 (notif client), M12 |
| `quote.sent / accepted / declined / expired` | M05 | M10 (relance devis), M04 |
| `invoice.issued / voided` | M08 | M09, M10 (créances), M08 (FNE) |
| `payment.received` | M08, webhooks | M09 (stop relances), M11 (reçu) |
| `message.inbound_received` | M11 | M17 (classement d'intention), M10 (stop si « STOP ») |
| `stock.below_minimum` | M07 | M12 (alerte), M07 (suggestion de commande) |

Les consommateurs sont **idempotents** (clé `eventId`).

## 6. Tâches planifiées (worker)

| Tâche | Fréquence | Rôle |
|---|---|---|
| `reminders.plan` | toutes les heures | Calcule les relances dues (M10) pour chaque organisation selon son fuseau |
| `reminders.dispatch` | toutes les 5 min | Envoie les relances validées/automatiques dans la plage horaire autorisée |
| `receivables.age` | tous les jours 01:00 | Met à jour statuts « en retard », ancienneté, scores |
| `vehicles.estimate_mileage` | tous les jours 02:00 | Kilométrage estimé du jour, prochaine révision |
| `imports.watch` | toutes les 15 min | Dossier surveillé / synchro base externe (M13) |
| `fne.retry` | toutes les 10 min | Re-soumet les factures non certifiées |
| `payments.reconcile` | toutes les 30 min | Vérifie les liens de paiement en attente |
| `digest.owner` | tous les jours 07:30 | Résumé quotidien du gérant (WhatsApp/email) |
| `stock.reorder_suggestions` | tous les jours 03:00 | Suggestions de réapprovisionnement |
| `backups.verify` | hebdomadaire | Contrôle d'une restauration |

Toutes les tâches : **verrou par organisation**, retries avec backoff exponentiel, journalisées, rejouables.

## 7. Conventions de code

- **Nommage** : code en anglais (`RepairOrder`, `invoice.issue()`), UI en français via `apps/web/messages/fr.json`.
- **Routes UI** en français (`/ordres`, `/creances`) ; routes API en anglais (`/api/v1/repair-orders`).
- **Montants** : type `Money = number` entier en FCFA ; jamais de `float` pour l'argent ; calculs dans `core/money` ; arrondi de la TVA **par ligne** puis somme (paramétrable).
- **Dates** : stockées en UTC (`timestamptz`) ; dates « métier » sans heure (expiration VT, échéance) en `date` ; affichage `dd/MM/yyyy` ; utiliser `date-fns` + `date-fns-tz`.
- **Numérotation** : séquences par organisation, type de document et année, sans trou pour les factures (`FAC-2026-000123`) ; transaction + verrou `SELECT … FOR UPDATE` sur la table `DocumentSequence`.
- **Suppression** : logicielle (`deletedAt`) pour les données métier ; les factures émises ne se suppriment **jamais** (avoir uniquement).
- **Erreurs** : erreurs métier typées (`DomainError` avec `code`), messages utilisateur en français.
- **Tests** : toute fonction de `core` a ses tests ; chaque module livre au moins un test E2E Playwright de son parcours principal.

## 8. Sécurité

- Mots de passe hachés (argon2), OTP à usage unique à durée courte, limitation de débit sur connexion/OTP/webhooks.
- Secrets des fournisseurs (clés WhatsApp, SMS, paiement, FNE, base externe) **chiffrés en base** (AES-256-GCM, clé maîtresse en variable d'environnement), jamais renvoyés au front.
- Webhooks : vérification de signature (Meta `X-Hub-Signature-256`, HMAC des agrégateurs de paiement), idempotence par identifiant de transaction.
- Liens publics du portail client : jetons aléatoires longs, expirables, révocables, à portée limitée (un devis, une facture).
- Fichiers : URL signées à durée courte ; contrôle du type MIME ; taille max.
- En-têtes de sécurité (CSP, HSTS), protection CSRF sur les actions.
- Journal d'audit immuable (`AuditLog`) : qui, quoi, quand, avant/après, IP.
- Sauvegardes chiffrées hors serveur.

## 9. Environnements et variables

`local` (Docker Compose complet + fournisseurs en mode **console** : les messages s'affichent dans les logs et dans une page `/dev/outbox`), `staging`, `production`.

```
DATABASE_URL=
REDIS_URL=
APP_URL=
ENCRYPTION_KEY=            # 32 octets base64
AUTH_SECRET=
S3_ENDPOINT= S3_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY=
ANTHROPIC_API_KEY=
SENTRY_DSN=
DEFAULT_TIMEZONE=Africa/Abidjan
```

Les identifiants WhatsApp/SMS/paiement/FNE sont **par organisation** (saisis dans M15), pas en variables d'environnement.

## 10. Adaptateurs externes (interfaces)

```ts
interface MessagingProvider {
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  send(msg: OutboundMessage): Promise<SendResult>;          // providerMessageId, cost?
  parseWebhook(req: Request): Promise<ProviderEvent[]>;     // statuts + messages entrants
  verifyWebhook(req: Request): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;
}

interface PaymentProvider {
  createPaymentLink(input: { invoiceId: string; amount: number; customer: {...}; expiresAt: Date }): Promise<{ url: string; providerRef: string }>;
  parseWebhook(req: Request): Promise<PaymentEvent>;
  getStatus(providerRef: string): Promise<PaymentStatus>;
}

interface FneProvider {
  certify(invoice: FneInvoicePayload): Promise<{ fneNumber: string; qrCode: string; signedAt: Date; raw: unknown }>;
  cancel?(fneNumber: string, reason: string): Promise<void>;
}
```

Chaque adaptateur a une implémentation **`console`/`manual`** utilisée en local et dans les tests, pour que l'application soit 100 % testable sans compte chez un fournisseur.

> Note FNE : la spécification exacte de l'API DGI doit être obtenue auprès de la DGI lors de l'inscription du garage. L'adaptateur est isolé ; tant qu'il n'est pas branché, le mode `manual` permet de saisir le numéro et le QR code FNE obtenus sur la plateforme web DGI.

## 11. Performances et hors-ligne

- Listes : pagination serveur par curseur, index sur (`organizationId`, champs filtrés).
- Recherche globale : `pg_trgm` sur nom client, téléphone, plaque, VIN, n° de document.
- Images : redimensionnées côté client avant envoi (max 1600 px, WebP).
- PWA mécanicien : cache des tâches assignées, file locale des pointages/photos/remarques, synchronisation avec résolution de conflits « serveur gagne sauf pointage ».
