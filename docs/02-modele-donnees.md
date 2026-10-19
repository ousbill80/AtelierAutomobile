# 02 — Modèle de données (source de vérité)

> Ce schéma Prisma est **la référence** pour tous les modules. Les PRD de modules utilisent exactement ces noms d'entités, de champs et d'énumérations. Toute évolution passe par une migration et une mise à jour de ce document.
>
> Conventions : clés `id String @id @default(cuid())` ; `organizationId` sur toute donnée métier ; montants en `Int` (FCFA) ; `createdAt`, `updatedAt` partout ; `deletedAt` pour la suppression logicielle des données métier.

---

## 1. Vue d'ensemble

```
Organization ─┬─ Site ─┬─ Bay
              │        └─ StockLevel
              ├─ Membership ── User
              ├─ Customer ─┬─ CustomerContact
              │            ├─ Vehicle ─┬─ MileageReading
              │            │           └─ VehicleEvent (historique)
              │            ├─ Appointment
              │            ├─ RepairOrder ─┬─ RepairOrderLine ── TimeEntry
              │            │               ├─ Inspection ── InspectionItem
              │            │               └─ Attachment
              │            ├─ Quote ── QuoteLine
              │            ├─ Invoice ─┬─ InvoiceLine
              │            │           └─ PaymentAllocation ── Payment
              │            ├─ CollectionCase ─┬─ PaymentPromise
              │            │                  └─ CollectionNote
              │            ├─ Reminder ── Message
              │            └─ Conversation ── Message
              ├─ Product ─ StockMovement, Supplier, PurchaseOrder ── PurchaseOrderLine
              ├─ ReminderRule, MessageTemplate, ChannelConfig, PaymentProviderConfig, FneConfig
              ├─ DataSource ── ImportJob ── ImportRowError ; ExternalRef
              ├─ InsuranceCompany ── InsuranceClaim
              └─ AuditLog, DomainEvent, Notification, DocumentSequence, AiInteraction
```

## 2. Schéma Prisma

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL"); extensions = [pg_trgm] }

// ───────────── Organisation, sites, utilisateurs ─────────────

model Organization {
  id              String   @id @default(cuid())
  name            String
  legalName       String?
  rccm            String?
  ncc             String?            // numéro de compte contribuable
  taxRegime       TaxRegime @default(RSI)
  vatRate         Int      @default(18)   // en %
  vatEnabled      Boolean  @default(true)
  currency        String   @default("XOF")
  timezone        String   @default("Africa/Abidjan")
  phone           String?
  email           String?
  address         String?
  city            String?  @default("Abidjan")
  logoUrl         String?
  invoiceFooter   String?
  plan            PlanTier @default(STARTER)
  operatingMode   OperatingMode @default(FULL)   // REMINDERS_ONLY si le garage garde son ancien logiciel
  settings        Json     @default("{}")        // préférences diverses (voir M15)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  sites           Site[]
  memberships     Membership[]
}

enum TaxRegime { RNI RSI RMI ENTREPRENANT }
enum PlanTier { STARTER PRO NETWORK }
enum OperatingMode { FULL REMINDERS_ONLY }

model Site {
  id             String @id @default(cuid())
  organizationId String
  name           String               // "Atelier Yopougon"
  code           String               // "YOP" (préfixe de numérotation)
  address        String?
  commune        String?
  phone          String?
  whatsappNumber String?
  openingHours   Json    @default("{}") // { mon: [["08:00","18:00"]], ... }
  isActive       Boolean @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  bays           Bay[]
  @@unique([organizationId, code])
}

model Bay {                              // pont / poste de travail
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  name           String                  // "Pont 1", "Carrosserie", "Diagnostic"
  type           BayType @default(LIFT)
  isActive       Boolean @default(true)
}
enum BayType { LIFT DIAGNOSTIC BODYWORK PAINT WASH OTHER }

model User {
  id            String  @id @default(cuid())
  name          String
  email         String? @unique
  phone         String? @unique         // E.164
  passwordHash  String?
  avatarUrl     String?
  locale        String  @default("fr")
  isActive      Boolean @default(true)
  lastLoginAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  memberships   Membership[]
}

model Membership {
  id             String @id @default(cuid())
  organizationId String
  userId         String
  role           Role
  permissions    String[]                // surcharges explicites "module:action"
  siteIds        String[]                // vide = tous les sites
  hourlyCost     Int?                    // coût horaire interne (mécaniciens)
  skills         String[]                // "moteur", "électricité", "climatisation", "carrosserie"
  isActive       Boolean @default(true)
  createdAt      DateTime @default(now())
  @@unique([organizationId, userId])
}
enum Role { OWNER MANAGER ADVISOR MECHANIC STOREKEEPER CASHIER ACCOUNTANT }

// ───────────── Clients et véhicules ─────────────

model Customer {
  id                 String @id @default(cuid())
  organizationId     String
  type               CustomerType @default(INDIVIDUAL)
  firstName          String?
  lastName           String?
  companyName        String?
  displayName        String                    // calculé : "Kouassi Jean-Marc" ou "SOTRA Logistique SARL"
  civility           Civility?
  phone              String?                   // E.164, principal
  phone2             String?
  hasWhatsapp        Boolean?                  // null = inconnu, détecté au 1er envoi
  whatsappPhone      String?                   // si différent
  email              String?
  address            String?
  commune            String?
  ncc                String?                   // entreprises
  rccm               String?
  preferredChannel   Channel?                  // null = suit l'ordre par défaut
  remindersConsent   Boolean @default(true)
  marketingConsent   Boolean @default(false)
  optedOutAt         DateTime?                 // a répondu STOP
  doNotRemind        Boolean @default(false)   // décision interne
  doNotRemindReason  String?
  paymentTermsDays   Int     @default(0)       // 0 = comptant
  creditLimit        Int?                      // en FCFA
  priceListId        String?
  discountRate       Int?                      // remise par défaut en %
  riskScore          Int?                      // 0-100, calculé (M09/M17)
  tags               String[]
  notes              String?
  source             String?                   // "import", "portail", "comptoir"
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  // M02 §14
  consentUpdatedAt   DateTime?
  consentSource      String?                   // counter | phone | whatsapp_reply | portal | import | staff
  mergedIntoId       String?                   // client cible après fusion (RG-M02-08)
  anonymizedAt       DateTime?
  lastVisitAt        DateTime?                 // dénormalisé (dernier OR livré ou facture), pour tri/filtre
  vehicles           Vehicle[]
  contacts           CustomerContact[]
  @@index([organizationId, displayName])
  @@index([organizationId, phone])
  @@index([organizationId, phone2])
  @@index([organizationId, email])
  // index trigram : CREATE INDEX customer_display_name_trgm ON "Customer" USING gin ("displayName" gin_trgm_ops);
}
enum CustomerType { INDIVIDUAL COMPANY }
enum Civility { M MME MLLE }
enum Channel { WHATSAPP SMS EMAIL }

model CustomerContact {                         // interlocuteurs d'une entreprise
  id                String @id @default(cuid())
  organizationId    String
  customerId        String
  name              String
  role              String?                        // "Responsable flotte", "Comptabilité"
  phone             String?
  phone2            String?                        // M02 §14
  email             String?
  receivesInvoices  Boolean @default(false)
  receivesReminders Boolean @default(false)
  isPrimary         Boolean  @default(false)       // M02 §14
  createdAt         DateTime @default(now())       // M02 §14
  deletedAt         DateTime?                      // M02 §14
}

model Vehicle {
  id                        String @id @default(cuid())
  organizationId            String
  customerId                String
  plate                     String                   // normalisée : majuscules, sans espaces multiples
  plateCompact              String                   // "2547GH01" — unicité et recherche (RG-M02-05)
  plateType                 PlateType @default(STANDARD)
  usage                     VehicleUsage @default(PRIVATE)
  vin                       String?
  make                      String                   // Toyota
  model                     String                   // Corolla
  makeId                    String?                  // lien catalogue (facultatif, make/model restent la vérité affichée)
  modelId                   String?
  version                   String?
  year                      Int?
  firstRegistrationDate     DateTime? @db.Date
  fuel                      FuelType?
  transmission              Transmission?
  engineCode                String?
  color                     String?
  fleetNumber               String?                  // n° interne flotte client
  driverName                String?
  driverPhone               String?
  // Kilométrage
  currentMileage            Int?
  currentMileageAt          DateTime?
  avgKmPerDay               Float?                   // calculé à partir des relevés
  estimatedMileage          Int?                     // estimé du jour (worker)
  odometerOffset            Int     @default(0)      // après remplacement de compteur (RG-M02-09)
  odometerInMiles           Boolean @default(false)
  // Visite technique
  inspectionLastDate        DateTime? @db.Date
  inspectionExpiryDate      DateTime? @db.Date
  inspectionCenter          String?
  // Révision
  serviceIntervalKm         Int?                     // ex. 10000
  serviceIntervalMonths     Int?                     // ex. 6
  lastServiceDate           DateTime? @db.Date
  lastServiceMileage        Int?
  nextServiceDueDate        DateTime? @db.Date       // calculé (M10)
  nextServiceDueMileage     Int?                     // calculé
  nextServiceTrigger        String?                  // "DATE" | "MILEAGE" (RG-M02-13)
  // Assurance
  insuranceCompanyId        String?
  insuranceExpiryDate       DateTime? @db.Date
  insurancePolicyNumber     String?
  notes                     String?
  mergedIntoId              String?                  // véhicule cible après fusion d'un doublon (RG-M02-08)
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
  deletedAt                 DateTime?
  @@index([organizationId, plate])
  @@index([organizationId, plateCompact])
  @@index([organizationId, vin])
  @@index([organizationId, inspectionExpiryDate])
  @@index([organizationId, nextServiceDueDate])
  // unicité partielle + index trigram :
  // CREATE UNIQUE INDEX vehicle_plate_unique ON "Vehicle" ("organizationId","plateCompact")
  //   WHERE "deletedAt" IS NULL AND "plateType" <> 'NONE';
  // CREATE INDEX vehicle_plate_compact_trgm ON "Vehicle" USING gin ("plateCompact" gin_trgm_ops);
}
enum FuelType { PETROL DIESEL HYBRID ELECTRIC LPG OTHER }
enum Transmission { MANUAL AUTOMATIC }
enum PlateType { STANDARD TEMPORARY DIPLOMATIC GOVERNMENT FOREIGN NONE OTHER }     // M02 §14
enum VehicleUsage { PRIVATE TAXI TRANSPORT UTILITY RENTAL OTHER }                  // M02 §14

model MileageReading {
  id             String @id @default(cuid())
  organizationId String
  vehicleId      String
  mileage        Int
  readAt         DateTime
  source         MileageSource
  repairOrderId  String?
  createdById    String?
  isOutlier      Boolean  @default(false)   // M02 §14
  createdAt      DateTime @default(now())   // M02 §14
}
enum MileageSource { RECEPTION IMPORT CUSTOMER MANUAL INVOICE }

model VehicleEvent {                             // historique libre (VT faite, accident, changement de propriétaire)
  id             String @id @default(cuid())
  organizationId String
  vehicleId      String
  type           String
  occurredAt     DateTime
  data           Json @default("{}")
  createdById    String?
}

model CustomerNote {                             // M02 §14 — notes internes datées (chronologie)
  id             String @id @default(cuid())
  organizationId String
  customerId     String
  vehicleId      String?
  body           String
  pinned         Boolean  @default(false)
  createdById    String?
  createdAt      DateTime @default(now())
  deletedAt      DateTime?
}

model DuplicateDismissal {                       // M02 §14 — paires de doublons ignorées (RG-M02-07)
  id             String @id @default(cuid())
  organizationId String
  entity         String                          // customer | vehicle
  idA            String                          // plus petit des deux id (ordre lexical)
  idB            String
  dismissedById  String?
  createdAt      DateTime @default(now())
  @@unique([organizationId, entity, idA, idB])
}

model CustomerSegment {                          // M02 §14 — segments enregistrés (campagnes M10, M12)
  id             String @id @default(cuid())
  organizationId String
  name           String
  filters        Json                            // mêmes clés que customer.list / vehicle.list
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model VehicleMake {                              // M02 §14 — catalogue marques (RG-M02-20) ; organizationId null = global
  id             String  @id @default(cuid())
  organizationId String?
  name           String                          // "Toyota"
  isActive       Boolean @default(true)
  @@unique([organizationId, name])
}

model VehicleModel {                             // M02 §14
  id                    String  @id @default(cuid())
  organizationId        String?
  makeId                String
  name                  String                   // "Corolla"
  yearFrom              Int?
  yearTo                Int?
  defaultFuel           FuelType?
  serviceIntervalKm     Int?                     // 10000
  serviceIntervalMonths Int?                     // 12
  isActive              Boolean @default(true)
  @@unique([makeId, organizationId, name])
}

// ───────────── Rendez-vous ─────────────

model Appointment {
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  customerId     String
  vehicleId      String?
  bayId          String?
  advisorId      String?                       // Membership.id
  startsAt       DateTime
  endsAt         DateTime
  type           AppointmentType
  status         AppointmentStatus @default(BOOKED)
  source         AppointmentSource @default(STAFF)
  reminderId     String?                       // relance à l'origine du RDV (attribution M12)
  notes          String?
  repairOrderId  String?                       // OR créé à l'arrivée
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
enum AppointmentType { SERVICE INSPECTION_PREP REPAIR DIAGNOSTIC BODYWORK TIRES OTHER }
enum AppointmentStatus { BOOKED CONFIRMED ARRIVED NO_SHOW CANCELLED COMPLETED }
enum AppointmentSource { STAFF PHONE WHATSAPP PORTAL REMINDER }

// ───────────── Ordres de réparation ─────────────

model RepairOrder {
  id                 String @id @default(cuid())
  organizationId     String
  siteId             String
  number             String                    // OR-YOP-2026-00042
  customerId         String
  vehicleId          String
  appointmentId      String?
  advisorId          String?
  status             RepairOrderStatus @default(DRAFT)
  priority           Priority @default(NORMAL)
  mileageIn          Int?
  fuelLevel          Int?                      // 0-8 (huitièmes)
  complaint          String?                   // doléances du client
  diagnosis          String?
  checkIn            Json @default("{}")       // état des lieux : rayures, objets, accessoires (voir M04)
  customerSignatureUrl String?
  signedAt           DateTime?
  promisedAt         DateTime?                 // date de restitution promise
  startedAt          DateTime?
  completedAt        DateTime?
  deliveredAt        DateTime?
  qcById             String?
  qcAt               DateTime?
  insuranceClaimId   String?
  internalNotes      String?
  totalEstimate      Int @default(0)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  @@unique([organizationId, number])
  @@index([organizationId, status])
}
enum RepairOrderStatus {
  DRAFT CHECKED_IN DIAGNOSING AWAITING_APPROVAL APPROVED IN_PROGRESS
  WAITING_PARTS QUALITY_CHECK READY DELIVERED INVOICED CANCELLED
}
enum Priority { LOW NORMAL HIGH URGENT }

model RepairOrderLine {
  id              String @id @default(cuid())
  organizationId  String
  repairOrderId   String
  type            LineType
  productId       String?
  laborOperationId String?
  description     String
  quantity        Float                       // heures pour la MO, unités pour les pièces
  unitPrice       Int
  discountRate    Int @default(0)
  vatRate         Int
  assignedToId    String?                     // Membership.id du mécanicien
  status          LineStatus @default(PENDING)
  approval        ApprovalState @default(NOT_REQUIRED)
  quoteLineId     String?
  payer           Payer @default(CUSTOMER)
  sortOrder       Int @default(0)
}
enum LineType { LABOR PART SUBCONTRACT FEE CONSUMABLE }
enum LineStatus { PENDING IN_PROGRESS DONE CANCELLED }
enum ApprovalState { NOT_REQUIRED PENDING APPROVED DECLINED }
enum Payer { CUSTOMER INSURANCE WARRANTY INTERNAL }

model Inspection {                               // inspection multipoints
  id             String @id @default(cuid())
  organizationId String
  repairOrderId  String
  templateId     String?
  performedById  String?
  completedAt    DateTime?
  items          InspectionItem[]
}
model InspectionItem {
  id             String @id @default(cuid())
  inspectionId   String
  category       String                       // Freinage, Pneumatiques, Éclairage…
  label          String                       // "Plaquettes avant"
  result         InspectionResult
  measurement    String?                      // "3 mm"
  comment        String?
  photoUrls      String[]
  recommendedProductIds String[]
  recommendedLaborIds   String[]
  addedToQuote   Boolean @default(false)
}
enum InspectionResult { OK WATCH URGENT NOT_CHECKED }

model InspectionTemplate {
  id             String @id @default(cuid())
  organizationId String
  name           String
  items          Json                          // [{category,label}]
}

model LaborOperation {                         // catalogue de main-d'œuvre
  id             String @id @default(cuid())
  organizationId String
  code           String
  name           String                        // "Vidange moteur + filtre"
  category       String?
  standardHours  Float                         // temps barème
  rateType       LaborRateType @default(STANDARD)
  fixedPrice     Int?                          // forfait éventuel
  isActive       Boolean @default(true)
}
enum LaborRateType { STANDARD DIAGNOSTIC BODYWORK ELECTRICAL }

model TimeEntry {                              // pointage mécanicien sur une tâche
  id               String @id @default(cuid())
  organizationId   String
  membershipId     String
  repairOrderId    String
  repairOrderLineId String?
  startedAt        DateTime
  endedAt          DateTime?
  pauseMinutes     Int @default(0)
  note             String?
  source           String @default("tablet")  // tablet | web | offline-sync
}

model Attendance {                             // présence journalière
  id             String @id @default(cuid())
  organizationId String
  membershipId   String
  date           DateTime @db.Date
  clockIn        DateTime?
  clockOut       DateTime?
}

// ───────────── Devis ─────────────

model Quote {
  id               String @id @default(cuid())
  organizationId   String
  siteId           String
  number           String                    // DEV-YOP-2026-00017
  version          Int @default(1)
  customerId       String
  vehicleId        String?
  repairOrderId    String?
  status           QuoteStatus @default(DRAFT)
  validUntil       DateTime @db.Date
  publicToken      String? @unique
  sentAt           DateTime?
  viewedAt         DateTime?
  decidedAt        DateTime?
  decisionChannel  String?                    // portal | whatsapp | in_person | phone
  signatureUrl     String?
  signerName       String?
  declineReason    String?
  subtotal         Int @default(0)
  discountTotal    Int @default(0)
  vatTotal         Int @default(0)
  total            Int @default(0)
  insuranceShare   Int @default(0)
  customerShare    Int @default(0)
  notes            String?
  createdById      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  lines            QuoteLine[]
  @@unique([organizationId, number, version])
}
enum QuoteStatus { DRAFT SENT VIEWED ACCEPTED PARTIALLY_ACCEPTED DECLINED EXPIRED CONVERTED }

model QuoteLine {
  id              String @id @default(cuid())
  quoteId         String
  type            LineType
  productId       String?
  laborOperationId String?
  description     String
  quantity        Float
  unitPrice       Int
  discountRate    Int @default(0)
  vatRate         Int
  isOptional      Boolean @default(false)
  priority        InspectionResult?          // URGENT / WATCH pour l'affichage client
  accepted        Boolean?                   // null = pas encore décidé
  payer           Payer @default(CUSTOMER)
  sortOrder       Int @default(0)
}

// ───────────── Stock et achats ─────────────

model Product {
  id              String @id @default(cuid())
  organizationId  String
  sku             String
  name            String
  brand           String?
  oemReference    String?
  barcode         String?
  category        String?                     // Filtration, Freinage, Lubrifiants…
  unit            String @default("pièce")    // pièce, litre, kit
  purchasePrice   Int @default(0)             // dernier prix d'achat
  averageCost     Int @default(0)             // CMP
  salePrice       Int @default(0)
  minSalePrice    Int?
  vatRate         Int @default(18)
  minStock        Int @default(0)
  reorderQty      Int?
  isStocked       Boolean @default(true)      // false = commandé à la demande
  compatibleWith  String[]                    // "Toyota Corolla 2014-2019"
  defaultSupplierId String?
  isActive        Boolean @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([organizationId, sku])
}

model StockLevel {
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  productId      String
  onHand         Int @default(0)
  reserved       Int @default(0)              // réservé pour des OR
  binLocation    String?                      // "Étagère B3"
  @@unique([siteId, productId])
}

model StockMovement {
  id              String @id @default(cuid())
  organizationId  String
  siteId          String
  productId       String
  type            StockMovementType
  quantity        Int                         // positif entrée, négatif sortie
  unitCost        Int?
  repairOrderId   String?
  purchaseOrderId String?
  reason          String?
  createdById     String?
  createdAt       DateTime @default(now())
}
enum StockMovementType { PURCHASE_RECEIPT ISSUE_TO_RO RETURN_FROM_RO ADJUSTMENT TRANSFER_OUT TRANSFER_IN COUNT_CORRECTION SUPPLIER_RETURN }

model Supplier {
  id             String @id @default(cuid())
  organizationId String
  name           String
  phone          String?
  whatsappPhone  String?
  email          String?
  address        String?
  paymentTermsDays Int @default(0)
  notes          String?
  isActive       Boolean @default(true)
}

model PurchaseOrder {
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  number         String                       // BC-YOP-2026-00008
  supplierId     String
  status         PurchaseOrderStatus @default(DRAFT)
  orderedAt      DateTime?
  expectedAt     DateTime?
  receivedAt     DateTime?
  repairOrderId  String?                      // commande liée à un OR
  total          Int @default(0)
  notes          String?
  lines          PurchaseOrderLine[]
  @@unique([organizationId, number])
}
enum PurchaseOrderStatus { DRAFT SENT PARTIALLY_RECEIVED RECEIVED CANCELLED }

model PurchaseOrderLine {
  id              String @id @default(cuid())
  purchaseOrderId String
  productId       String
  quantity        Int
  receivedQty     Int @default(0)
  unitCost        Int
}

// ───────────── Facturation, paiements, caisse ─────────────

model Invoice {
  id               String @id @default(cuid())
  organizationId   String
  siteId           String
  number           String?                    // attribué à l'émission : FAC-2026-000123 (sans trou)
  type             InvoiceType @default(INVOICE)
  status           InvoiceStatus @default(DRAFT)
  customerId       String
  vehicleId        String?
  repairOrderId    String?
  quoteId          String?
  creditedInvoiceId String?                   // pour un avoir
  billTo           Payer @default(CUSTOMER)   // facture client ou facture assurance
  insuranceClaimId String?
  issuedAt         DateTime?
  dueDate          DateTime? @db.Date
  subtotal         Int @default(0)
  discountTotal    Int @default(0)
  vatTotal         Int @default(0)
  total            Int @default(0)
  amountPaid       Int @default(0)
  balance          Int @default(0)            // total - amountPaid (dénormalisé, maintenu en transaction)
  mileage          Int?
  notes            String?
  publicToken      String? @unique
  // FNE
  fneStatus        FneStatus @default(NOT_REQUIRED)
  fneNumber        String?
  fneQrCode        String?
  fneCertifiedAt   DateTime?
  fneError         String?
  fneRaw           Json?
  voidedAt         DateTime?
  voidReason       String?
  createdById      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  lines            InvoiceLine[]
  @@unique([organizationId, number])
  @@index([organizationId, status, dueDate])
}
enum InvoiceType { INVOICE CREDIT_NOTE DEPOSIT }
enum InvoiceStatus { DRAFT ISSUED PARTIALLY_PAID PAID OVERDUE VOID WRITTEN_OFF DISPUTED }
enum FneStatus { NOT_REQUIRED PENDING CERTIFIED FAILED MANUAL }

model InvoiceLine {
  id              String @id @default(cuid())
  invoiceId       String
  type            LineType
  productId       String?
  laborOperationId String?
  description     String
  quantity        Float
  unitPrice       Int
  discountRate    Int @default(0)
  vatRate         Int
  lineSubtotal    Int                         // calculé et figé à l'émission
  lineVat         Int
  lineTotal       Int
  sortOrder       Int @default(0)
}

model Payment {
  id               String @id @default(cuid())
  organizationId   String
  siteId           String
  customerId       String?
  number           String                     // REC-2026-000310 (reçu)
  method           PaymentMethod
  amount           Int
  receivedAt       DateTime
  reference        String?                    // ID transaction Wave/OM, n° chèque
  status           PaymentStatus @default(CONFIRMED)
  provider         String?                    // cinetpay | wave | manual
  providerRef      String?
  cashSessionId    String?
  receivedById     String?
  unallocated      Int @default(0)            // acompte / trop-perçu
  notes            String?
  createdAt        DateTime @default(now())
  allocations      PaymentAllocation[]
  @@unique([organizationId, number])
  @@unique([provider, providerRef])
}
enum PaymentMethod { CASH WAVE ORANGE_MONEY MTN_MOMO MOOV_MONEY CARD BANK_TRANSFER CHEQUE INSURANCE OTHER }
enum PaymentStatus { PENDING CONFIRMED FAILED REFUNDED }

model PaymentAllocation {
  id         String @id @default(cuid())
  paymentId  String
  invoiceId  String
  amount     Int
}

model PaymentLink {
  id             String @id @default(cuid())
  organizationId String
  invoiceId      String
  provider       String
  providerRef    String
  url            String
  amount         Int
  status         PaymentStatus @default(PENDING)
  expiresAt      DateTime
  paymentId      String?
  createdAt      DateTime @default(now())
}

model CashSession {                              // ouverture / clôture de caisse
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  openedById     String
  openedAt       DateTime
  openingFloat   Int
  closedById     String?
  closedAt       DateTime?
  expectedCash   Int?
  countedCash    Int?
  difference     Int?
  notes          String?
}

model Expense {                                  // décaissements de caisse (petites dépenses)
  id             String @id @default(cuid())
  organizationId String
  siteId         String
  cashSessionId  String?
  category       String
  amount         Int
  description    String
  paidAt         DateTime
  createdById    String?
}

// ───────────── Créances et recouvrement ─────────────

model CollectionCase {                           // un dossier par client ayant un solde en retard
  id               String @id @default(cuid())
  organizationId   String
  customerId       String
  status           CollectionStatus @default(OPEN)
  stage            Int @default(0)              // palier atteint dans la séquence
  assignedToId     String?
  totalDue         Int @default(0)
  oldestDueDate    DateTime? @db.Date
  nextActionAt     DateTime?
  pausedUntil      DateTime?
  closedAt         DateTime?
  closeReason      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  promises         PaymentPromise[]
  notes            CollectionNote[]
}
enum CollectionStatus { OPEN PROMISED PAUSED DISPUTED ESCALATED CLOSED_PAID CLOSED_WRITTEN_OFF }

model PaymentPromise {
  id               String @id @default(cuid())
  collectionCaseId String
  amount           Int
  promisedDate     DateTime @db.Date
  channel          String?                    // téléphone, WhatsApp, en personne
  status           PromiseStatus @default(PENDING)
  createdById      String?
  createdAt        DateTime @default(now())
}
enum PromiseStatus { PENDING KEPT PARTIALLY_KEPT BROKEN }

model CollectionNote {
  id               String @id @default(cuid())
  collectionCaseId String
  body             String
  type             String @default("note")   // note | call | visit
  createdById      String?
  createdAt        DateTime @default(now())
}

// ───────────── Relances et messages ─────────────

model ReminderRule {
  id              String @id @default(cuid())
  organizationId  String
  type            ReminderType
  name            String
  isActive        Boolean @default(true)
  steps           Json        // [{ key:"J-30", offsetDays:-30, templateKey:"vt_j30", autoSend:true, channels:["WHATSAPP","SMS"] }, ...]
  sendWindow      Json        // { days:[1,2,3,4,5,6], from:"08:00", to:"19:00" }
  conditions      Json @default("{}")   // { customerTypes:["INDIVIDUAL"], minAmount:5000, tags:[] }
  stopOn          String[]    // ["appointment.created","payment.received","quote.accepted"]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
enum ReminderType { INSPECTION SERVICE RECEIVABLE APPOINTMENT QUOTE_FOLLOWUP VEHICLE_READY INSURANCE_EXPIRY SATISFACTION CUSTOM }

model Reminder {                                  // une occurrence planifiée
  id              String @id @default(cuid())
  organizationId  String
  ruleId          String
  type            ReminderType
  stepKey         String                        // "J-30"
  customerId      String
  vehicleId       String?
  invoiceId       String?
  appointmentId   String?
  quoteId         String?
  dueDate         DateTime @db.Date             // échéance de référence (expiration VT, échéance facture…)
  scheduledFor    DateTime                      // quand l'envoyer
  status          ReminderStatus @default(PLANNED)
  channel         Channel?
  renderedBody    String?
  approvedById    String?
  approvedAt      DateTime?
  sentAt          DateTime?
  skippedReason   String?
  snoozedUntil    DateTime?
  outcome         ReminderOutcome?
  outcomeAt       DateTime?
  dedupeKey       String                        // ex. "INSPECTION:veh_123:2026-11-02:J-30"
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([organizationId, dedupeKey])
  @@index([organizationId, status, scheduledFor])
}
enum ReminderStatus { PLANNED NEEDS_APPROVAL QUEUED SENT FAILED SKIPPED SNOOZED CANCELLED }
enum ReminderOutcome { APPOINTMENT_BOOKED PAID PARTIALLY_PAID PROMISED REPLIED NO_RESPONSE OPTED_OUT }

model MessageTemplate {
  id                 String @id @default(cuid())
  organizationId     String
  key                String                      // "vt_j30"
  name               String
  channel            Channel
  subject            String?                     // email
  body               String                      // avec variables {{client.prenom}}
  whatsappTemplateName String?                   // nom du modèle approuvé chez Meta
  whatsappLanguage   String? @default("fr")
  whatsappStatus     String?                     // APPROVED | PENDING | REJECTED
  isActive           Boolean @default(true)
  @@unique([organizationId, key, channel])
}

model Conversation {
  id              String @id @default(cuid())
  organizationId  String
  customerId      String?
  channel         Channel
  externalAddress String                        // téléphone ou email
  status          ConversationStatus @default(OPEN)
  assignedToId    String?
  lastMessageAt   DateTime
  unreadCount     Int @default(0)
  lastIntent      String?                       // classé par l'IA (M17)
  @@unique([organizationId, channel, externalAddress])
}
enum ConversationStatus { OPEN PENDING CLOSED }

model Message {
  id                 String @id @default(cuid())
  organizationId     String
  conversationId     String?
  customerId         String?
  reminderId         String?
  direction          Direction
  channel            Channel
  to                 String
  from               String?
  subject            String?
  body               String
  attachments        Json @default("[]")
  status             MessageStatus @default(QUEUED)
  provider           String
  providerMessageId  String?
  errorCode          String?
  errorMessage       String?
  cost               Int?                        // FCFA
  fallbackOfId       String?                     // message d'origine si repli (WhatsApp → SMS)
  sentById           String?                     // null = automatique
  createdAt          DateTime @default(now())
  sentAt             DateTime?
  deliveredAt        DateTime?
  readAt             DateTime?
  @@index([organizationId, providerMessageId])
}
enum Direction { OUTBOUND INBOUND }
enum MessageStatus { QUEUED SENDING SENT DELIVERED READ FAILED RECEIVED }

model ChannelConfig {
  id             String @id @default(cuid())
  organizationId String
  channel        Channel
  provider       String                          // whatsapp_cloud | wa_link | orange_sms | twilio | http_sms | smtp | resend | console
  isActive       Boolean @default(false)
  priority       Int @default(1)
  credentials    String                          // JSON chiffré (AES-256-GCM)
  senderId       String?                         // nom d'expéditeur SMS, numéro WhatsApp, email from
  status         String?                         // OK | ERROR
  lastCheckedAt  DateTime?
  balance        Int?                            // crédit SMS restant si disponible
  @@unique([organizationId, channel, provider])
}

model OptOut {
  id             String @id @default(cuid())
  organizationId String
  address        String                          // téléphone ou email
  channel        Channel?
  reason         String?
  createdAt      DateTime @default(now())
  @@unique([organizationId, address, channel])
}

// ───────────── Paramètres fournisseurs paiement / FNE ─────────────

model PaymentProviderConfig {
  id             String @id @default(cuid())
  organizationId String
  provider       String                          // cinetpay | wave
  isActive       Boolean @default(false)
  credentials    String                          // chiffré
  methods        PaymentMethod[]
}

model FneConfig {
  id             String @id @default(cuid())
  organizationId String @unique
  mode           String @default("manual")       // api | manual | disabled
  credentials    String?                         // chiffré
  establishmentId String?
  pointOfSale    String?
  isActive       Boolean @default(false)
}

// ───────────── Import / synchronisation ─────────────

model DataSource {
  id             String @id @default(cuid())
  organizationId String
  type           DataSourceType
  name           String
  config         String                          // JSON chiffré : chemin, connexion SQL, requêtes, mapping
  mapping        Json @default("{}")
  schedule       String?                         // cron
  isActive       Boolean @default(true)
  lastRunAt      DateTime?
  lastStatus     String?
}
enum DataSourceType { FILE_UPLOAD WATCHED_FOLDER SQL_DATABASE REST_API WEBHOOK }

model ImportJob {
  id             String @id @default(cuid())
  organizationId String
  dataSourceId   String?
  entity         String                          // customers | vehicles | invoices | payments | products
  fileUrl        String?
  status         ImportStatus @default(PENDING)
  dryRun         Boolean @default(false)
  totalRows      Int @default(0)
  createdCount   Int @default(0)
  updatedCount   Int @default(0)
  skippedCount   Int @default(0)
  errorCount     Int @default(0)
  startedAt      DateTime?
  finishedAt     DateTime?
  createdById    String?
  errors         ImportRowError[]
}
enum ImportStatus { PENDING VALIDATING READY RUNNING COMPLETED FAILED }

model ImportRowError {
  id          String @id @default(cuid())
  importJobId String
  rowNumber   Int
  field       String?
  message     String
  raw         Json
}

model ExternalRef {                               // lien entre un enregistrement et son ID dans le logiciel source
  id             String @id @default(cuid())
  organizationId String
  dataSourceId   String
  entity         String
  externalId     String
  internalId     String
  hash           String?                         // détection des changements
  @@unique([dataSourceId, entity, externalId])
}

model ApiKey {
  id             String @id @default(cuid())
  organizationId String
  name           String
  keyHash        String @unique
  prefix         String                          // affiché : "ak_live_3f9a…"
  scopes         String[]
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime @default(now())
}

model WebhookEndpoint {                           // webhooks sortants vers d'autres systèmes
  id             String @id @default(cuid())
  organizationId String
  url            String
  secret         String
  events         String[]
  isActive       Boolean @default(true)
}

// ───────────── Assurances ─────────────

model InsuranceCompany {
  id             String @id @default(cuid())
  organizationId String
  name           String
  phone          String?
  email          String?
  paymentTermsDays Int @default(60)
}

model InsuranceClaim {
  id                 String @id @default(cuid())
  organizationId     String
  insuranceCompanyId String
  customerId         String
  vehicleId          String
  claimNumber        String?
  policyNumber       String?
  accidentDate       DateTime? @db.Date
  expertName         String?
  expertVisitAt      DateTime?
  status             ClaimStatus @default(OPENED)
  deductible         Int @default(0)                 // franchise client
  approvedAmount     Int?
  notes              String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
enum ClaimStatus { OPENED EXPERT_SCHEDULED ESTIMATE_SENT APPROVED REPAIRING INVOICED PAID REJECTED }

// ───────────── Transverse ─────────────

model Attachment {
  id             String @id @default(cuid())
  organizationId String
  entity         String                          // repair_order | vehicle | invoice | claim | inspection_item
  entityId       String
  kind           String                          // photo_checkin | photo_damage | signature | document
  url            String
  mimeType       String
  size           Int
  caption        String?
  createdById    String?
  createdAt      DateTime @default(now())
}

model DocumentSequence {
  id             String @id @default(cuid())
  organizationId String
  siteId         String?
  docType        String                          // OR | DEV | FAC | AV | REC | BC
  year           Int
  lastValue      Int @default(0)
  @@unique([organizationId, siteId, docType, year])
}

model AuditLog {
  id             String @id @default(cuid())
  organizationId String
  userId         String?
  action         String                          // invoice.void, stock.adjust…
  entity         String
  entityId       String
  before         Json?
  after          Json?
  reason         String?
  ip             String?
  createdAt      DateTime @default(now())
  @@index([organizationId, entity, entityId])
}

model DomainEvent {
  id             String @id @default(cuid())
  organizationId String
  type           String
  payload        Json
  occurredAt     DateTime @default(now())
  processedAt    DateTime?
}

model Notification {                              // notifications internes de l'application
  id             String @id @default(cuid())
  organizationId String
  membershipId   String
  type           String
  title          String
  body           String?
  link           String?
  readAt         DateTime?
  createdAt      DateTime @default(now())
}

model AiInteraction {                             // trace des appels IA (coût, qualité)
  id             String @id @default(cuid())
  organizationId String
  feature        String                          // quote_draft | intent_classification | …
  inputRef       String?
  output         Json
  accepted       Boolean?                        // l'utilisateur a-t-il gardé la suggestion
  tokensIn       Int?
  tokensOut      Int?
  createdById    String?
  createdAt      DateTime @default(now())
}
```

> Les relations (`@relation`) et les clés étrangères sont à compléter à l'implémentation selon les champs `…Id` ci-dessus. Chaque champ `…Id` pointant vers une autre table **doit** avoir sa relation et un index.

## 3. Règles d'intégrité

| Règle                                                                                                                               | Où                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `Invoice.number` attribué uniquement à l'émission, séquence sans trou par organisation et par année                                 | `core/numbering` + `DocumentSequence` en transaction |
| Une facture `ISSUED` n'est plus modifiable ; correction = **avoir** (`CREDIT_NOTE`)                                                 | M08                                                  |
| `Invoice.amountPaid` = somme des `PaymentAllocation.amount` ; `balance = total - amountPaid` ; statut recalculé à chaque allocation | `core/receivables`                                   |
| `StockLevel.onHand` = somme des `StockMovement.quantity` ; jamais modifié sans mouvement                                            | M07                                                  |
| `StockLevel.reserved` ≤ `onHand` sauf autorisation de stock négatif                                                                 | M07                                                  |
| `Reminder.dedupeKey` unique → impossible d'envoyer deux fois le même palier pour la même échéance                                   | M10                                                  |
| `Vehicle.plate` normalisée (majuscules, espaces simples) et unique **par organisation** parmi les véhicules non supprimés           | M02                                                  |
| `Customer.phone` normalisé E.164                                                                                                    | `core/phone`                                         |
| Un message n'est jamais envoyé à une adresse présente dans `OptOut` (sauf messages transactionnels : facture, véhicule prêt)        | M11                                                  |

## 4. Variables de modèles de messages

Disponibles dans `MessageTemplate.body` (moteur **Handlebars**, sans exécution de code) :

| Variable                                                                                                        | Exemple                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `{{client.civilite}}` `{{client.nom}}` `{{client.prenom}}` `{{client.nomComplet}}`                              | M. · Kouassi · Jean-Marc           |
| `{{vehicule.marque}}` `{{vehicule.modele}}` `{{vehicule.plaque}}`                                               | Toyota · Corolla · 2547 GH 01      |
| `{{vt.dateExpiration}}` `{{vt.joursRestants}}`                                                                  | 02/11/2026 · 15                    |
| `{{revision.dateEcheance}}` `{{revision.kmEcheance}}` `{{vehicule.kmEstime}}`                                   | 15/12/2026 · 25 000 · 24 200       |
| `{{facture.numero}}` `{{facture.montant}}` `{{facture.solde}}` `{{facture.echeance}}` `{{facture.joursRetard}}` | FAC-2026-000412 · 185 000 FCFA · … |
| `{{client.soldeTotal}}` `{{client.nbFacturesOuvertes}}`                                                         | 1 240 000 FCFA · 3                 |
| `{{lien.paiement}}` `{{lien.devis}}` `{{lien.facture}}` `{{lien.rdv}}`                                          | liens courts du portail            |
| `{{rdv.date}}` `{{rdv.heure}}`                                                                                  | 24/10/2026 · 09:00                 |
| `{{devis.numero}}` `{{devis.montant}}` `{{devis.validite}}`                                                     |                                    |
| `{{garage.nom}}` `{{garage.telephone}}` `{{garage.adresse}}` `{{garage.horaires}}`                              |                                    |
| `{{paiement.wave}}` `{{paiement.orangeMoney}}` `{{paiement.mtn}}`                                               | numéros marchands                  |
