import { generateCiHolidays, hashPassword, normalizePlate } from "@atelieros/core";
import { adminDb } from "../src/client";
import type { Prisma } from "@prisma/client";

// Date de référence fixe pour que les écarts relatifs ("retard de 38 j", "VT expire
// dans 15 j"...) restent cohérents même si le seed est rejoué un autre jour.
const TODAY = new Date("2026-10-18T00:00:00.000Z");

function daysFrom(days: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const FIRST_NAMES = [
  "Kouadio",
  "Aya",
  "Yao",
  "Akissi",
  "Konan",
  "Adjoua",
  "N'Guessan",
  "Affoué",
  "Kouassi",
  "Amenan",
  "Brou",
  "Akoua",
  "Kra",
  "Ahou",
  "Koffi",
  "Awa",
  "Diarra",
  "Fatou",
  "Ibrahim",
  "Mariam",
  "Issouf",
  "Salimata",
  "Abou",
  "Nafissatou",
  "Souleymane",
  "Djénéba",
  "Lassina",
  "Kadidja",
  "Bakary",
  "Rokia",
  "Moussa",
  "Adama",
  "Sekou",
];

const LAST_NAMES = [
  "Kouassi",
  "Bamba",
  "Koné",
  "Traoré",
  "Ouattara",
  "Diabaté",
  "Yao",
  "N'Dri",
  "Kouamé",
  "Diallo",
  "Coulibaly",
  "Touré",
  "Brou",
  "Konan",
  "Kacou",
  "Soro",
  "Cissé",
  "Silué",
  "Gbagbo",
  "Assi",
];

const VEHICLE_CATALOG: Array<{ make: string; model: string; fuel: "PETROL" | "DIESEL" }> = [
  { make: "Toyota", model: "Corolla", fuel: "PETROL" },
  { make: "Toyota", model: "Hilux", fuel: "DIESEL" },
  { make: "Peugeot", model: "301", fuel: "PETROL" },
  { make: "Hyundai", model: "Tucson", fuel: "PETROL" },
  { make: "Kia", model: "Picanto", fuel: "PETROL" },
  { make: "Mitsubishi", model: "L200", fuel: "DIESEL" },
  { make: "Suzuki", model: "Swift", fuel: "PETROL" },
  { make: "Renault", model: "Duster", fuel: "DIESEL" },
  { make: "Nissan", model: "Navara", fuel: "DIESEL" },
  { make: "Isuzu", model: "D-Max", fuel: "DIESEL" },
];

const COMMUNES = ["Yopougon", "Cocody", "Abobo", "Adjamé", "Marcory", "Treichville", "Koumassi"];

// RG-M02-20 — catalogue global marques/modèles courants en Côte d'Ivoire, avec intervalle
// de révision par défaut (km / mois). Les véhicules utilitaires/diesel (pick-up, 4x4) ont
// un intervalle plus court que les véhicules particuliers essence.
type FuelSeed = "PETROL" | "DIESEL";
const VEHICLE_MAKE_CATALOG: Array<{
  name: string;
  models: Array<{
    name: string;
    fuel: FuelSeed;
    serviceIntervalKm: number;
    serviceIntervalMonths: number;
  }>;
}> = [
  {
    name: "Toyota",
    models: [
      { name: "Corolla", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Hilux", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
      { name: "Land Cruiser", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
      { name: "Yaris", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "RAV4", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Hyundai",
    models: [
      { name: "Tucson", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Accent", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "H100", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
    ],
  },
  {
    name: "Kia",
    models: [
      { name: "Picanto", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Sportage", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Rio", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Nissan",
    models: [
      { name: "Navara", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
      { name: "Patrol", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
      { name: "Qashqai", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Mitsubishi",
    models: [
      { name: "L200", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
      { name: "Pajero", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
    ],
  },
  {
    name: "Suzuki",
    models: [
      { name: "Swift", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Jimny", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Isuzu",
    models: [{ name: "D-Max", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 }],
  },
  {
    name: "Peugeot",
    models: [
      { name: "301", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "2008", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Partner", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Renault",
    models: [
      { name: "Duster", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Logan", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Citroën",
    models: [{ name: "C4", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Mercedes-Benz",
    models: [
      { name: "Classe C", fuel: "DIESEL", serviceIntervalKm: 15000, serviceIntervalMonths: 12 },
      { name: "Sprinter", fuel: "DIESEL", serviceIntervalKm: 15000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "BMW",
    models: [
      { name: "Série 3", fuel: "PETROL", serviceIntervalKm: 15000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Ford",
    models: [
      { name: "Ranger", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
    ],
  },
  {
    name: "Honda",
    models: [{ name: "CR-V", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Mazda",
    models: [{ name: "CX-5", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Volkswagen",
    models: [{ name: "Polo", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Land Rover",
    models: [
      { name: "Defender", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Chevrolet",
    models: [{ name: "Aveo", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Changan",
    models: [{ name: "CS35", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Geely",
    models: [
      { name: "Coolray", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Chery",
    models: [
      { name: "Tiggo", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
  },
  {
    name: "Dongfeng",
    models: [{ name: "AX7", fuel: "PETROL", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  },
  {
    name: "Great Wall",
    models: [
      { name: "Wingle", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 },
    ],
  },
  {
    name: "JAC",
    models: [{ name: "T6", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 }],
  },
  {
    name: "Tata",
    models: [{ name: "Xenon", fuel: "DIESEL", serviceIntervalKm: 10000, serviceIntervalMonths: 6 }],
  },
];

function plateFor(index: number): string {
  const letters = ["AB", "CD", "EF", "GH", "JK", "LM", "FD", "HB", "NP", "RS"];
  const letter = letters[index % letters.length];
  const num = 1000 + index;
  return `${num} ${letter} 01`;
}

// RG-M02-05 : dérive plate/plateCompact/plateType depuis la saisie, au lieu de recopier
// à la main la forme compacte dans chaque fixture du seed.
function plateFields(input: string) {
  const normalized = normalizePlate(input);
  return {
    plate: normalized.plate,
    plateCompact: normalized.plateCompact,
    plateType: normalized.plateType,
  };
}

function phoneFor(index: number): string {
  const prefixes = ["07", "05", "01"];
  const prefix = prefixes[index % prefixes.length];
  const suffix = String(10000000 + index * 37).slice(0, 8);
  return `+225${prefix}${suffix}`;
}

async function main() {
  console.log("Seed — suppression des données de démonstration précédentes...");
  const existing = await adminDb.organization.findFirst({ where: { name: "Excellence Auto" } });
  if (existing) {
    await adminDb.organization.delete({ where: { id: existing.id } });
  }

  console.log("Seed — organisation et sites...");
  const organization = await adminDb.organization.create({
    data: {
      name: "Excellence Auto",
      legalName: "Excellence Auto SARL",
      rccm: "CI-ABJ-2015-B-12345",
      ncc: "1234567A",
      taxRegime: "RSI",
      vatRate: 18,
      vatEnabled: true,
      phone: "+2252722000000",
      email: "contact@excellence-auto.ci",
      address: "Boulevard de l'Industrie",
      city: "Abidjan",
      plan: "PRO",
      operatingMode: "FULL",
    },
  });

  // Horaires types d'un atelier ivoirien (M15 US-M15-03) : lun-ven 07:30-12:00 / 13:00-18:00,
  // sam 08:00-14:00, fermé dimanche.
  const standardOpeningHours = {
    mon: [
      ["07:30", "12:00"],
      ["13:00", "18:00"],
    ],
    tue: [
      ["07:30", "12:00"],
      ["13:00", "18:00"],
    ],
    wed: [
      ["07:30", "12:00"],
      ["13:00", "18:00"],
    ],
    thu: [
      ["07:30", "12:00"],
      ["13:00", "18:00"],
    ],
    fri: [
      ["07:30", "12:00"],
      ["13:00", "18:00"],
    ],
    sat: [["08:00", "14:00"]],
    sun: [],
  };

  const siteYopougon = await adminDb.site.create({
    data: {
      organizationId: organization.id,
      name: "Atelier Yopougon",
      code: "YOP",
      commune: "Yopougon",
      phone: "+2252722000001",
      whatsappNumber: "+2252722000001",
      openingHours: standardOpeningHours,
      isActive: true,
    },
  });
  const siteCocody = await adminDb.site.create({
    data: {
      organizationId: organization.id,
      name: "Atelier Cocody",
      code: "COC",
      commune: "Cocody",
      phone: "+2252722000002",
      whatsappNumber: "+2252722000002",
      openingHours: standardOpeningHours,
      isActive: true,
    },
  });

  console.log("Seed — jours fériés 2026 (M15 RG-M15-08)...");
  for (const holiday of generateCiHolidays(2026)) {
    await adminDb.holiday.create({
      data: {
        organizationId: organization.id,
        siteId: null,
        date: new Date(Date.UTC(holiday.date.year, holiday.date.month - 1, holiday.date.day)),
        name: holiday.name,
        kind: "PUBLIC",
        isEstimated: holiday.isEstimated,
      },
    });
  }

  const baysYopougon = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      adminDb.bay.create({
        data: {
          organizationId: organization.id,
          siteId: siteYopougon.id,
          name: `Pont ${n}`,
          type: "LIFT",
        },
      }),
    ),
  );
  const baysCocody = await Promise.all(
    [1, 2].map((n) =>
      adminDb.bay.create({
        data: {
          organizationId: organization.id,
          siteId: siteCocody.id,
          name: `Pont ${n}`,
          type: "LIFT",
        },
      }),
    ),
  );

  console.log("Seed — utilisateurs et équipe...");
  const teamSpec: Array<{
    name: string;
    role: Prisma.MembershipCreateInput["role"];
    skills: string[];
  }> = [
    { name: "Kouadio N'Guessan (gérant)", role: "OWNER", skills: [] },
    { name: "Aya Koffi (chef d'atelier)", role: "MANAGER", skills: ["moteur", "électricité"] },
    { name: "Yao Brou (réceptionniste)", role: "ADVISOR", skills: [] },
    { name: "Konan Kra (mécanicien)", role: "MECHANIC", skills: ["moteur", "distribution"] },
    {
      name: "Issouf Diarra (mécanicien)",
      role: "MECHANIC",
      skills: ["climatisation", "électricité"],
    },
    { name: "Bakary Sekou (mécanicien)", role: "MECHANIC", skills: ["carrosserie"] },
    { name: "Fatou Cissé (magasinière)", role: "STOREKEEPER", skills: [] },
    { name: "Adama Touré (caissier)", role: "CASHIER", skills: [] },
    { name: "Mariam Silué (comptable)", role: "ACCOUNTANT", skills: [] },
  ];

  // Mot de passe de démonstration pour tous les comptes semés, haché en argon2id
  // (RG-M01-03) et stocké dans Account (providerId "credential"), cf. arbitrage A6.
  const demoPasswordHash = await hashPassword("demo1234");

  const memberships: Record<string, { userId: string; membershipId: string }> = {};
  for (const [i, spec] of teamSpec.entries()) {
    const email = `demo.${spec.role.toLowerCase()}.${i}@excellence-auto.ci`;
    const phone = phoneFor(900 + i);
    const user = await adminDb.user.create({
      data: {
        name: spec.name,
        email,
        phone,
        emailVerifiedAt: TODAY,
        phoneVerifiedAt: TODAY,
        locale: "fr",
      },
    });
    await adminDb.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        // accountId = User.id : un seul mot de passe par utilisateur, indépendant de
        // l'identifiant (email ou téléphone) utilisé pour se connecter.
        accountId: user.id,
        password: demoPasswordHash,
      },
    });
    const membership = await adminDb.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: spec.role,
        skills: spec.skills,
        siteIds: [],
      },
    });
    memberships[spec.role] = { userId: user.id, membershipId: membership.id };
  }
  const advisorMembershipId = memberships.ADVISOR!.membershipId;
  const cashierMembershipId = memberships.CASHIER!.membershipId;

  console.log("Seed — fournisseurs...");
  const supplierNames = [
    "CFAO Motors",
    "Tropical Pièces Auto",
    "Ivoire Lubrifiants",
    "SOCIDA Distribution",
    "Abidjan Pneus Service",
  ];
  const suppliers = await Promise.all(
    supplierNames.map((name, i) =>
      adminDb.supplier.create({
        data: {
          organizationId: organization.id,
          name,
          phone: phoneFor(800 + i),
          paymentTermsDays: 30,
        },
      }),
    ),
  );

  console.log("Seed — catalogue main-d'œuvre...");
  const laborCatalog = [
    ["VID", "Vidange moteur + filtre", 0.5],
    ["FRA", "Remplacement plaquettes avant", 1],
    ["FRR", "Remplacement plaquettes arrière", 1],
    ["DIST", "Remplacement courroie de distribution", 4],
    ["DIAG", "Diagnostic électronique", 0.5],
    ["CLIM", "Recharge climatisation", 1],
    ["AMORT", "Remplacement amortisseur (unité)", 1.5],
    ["EMBR", "Remplacement embrayage", 5],
    ["ALT", "Remplacement alternateur", 2],
    ["DEM", "Remplacement démarreur", 2],
    ["BAT", "Remplacement batterie", 0.3],
    ["PARE", "Remplacement pare-brise", 1.5],
    ["GEO", "Géométrie / parallélisme", 0.75],
    ["PNEU", "Montage + équilibrage pneu (unité)", 0.25],
    ["RADI", "Remplacement radiateur", 2],
    ["POMPE", "Remplacement pompe à eau", 2.5],
    ["JOINT", "Joint de culasse", 6],
    ["ECH", "Remplacement silencieux / échappement", 1.5],
    ["SUSP", "Révision train avant", 2],
    ["CARR1", "Débosselage aile", 2],
    ["CARR2", "Peinture élément de carrosserie", 3],
    ["ELEC1", "Dépannage électrique divers", 1],
    ["VITRE", "Réparation lève-vitre", 1],
    ["ROTUL", "Remplacement rotule de direction", 1.5],
    ["CARD", "Remplacement cardan", 2],
    ["TURBO", "Remplacement turbocompresseur", 4],
    ["INJEC", "Nettoyage injecteurs", 1.5],
    ["CAPT", "Remplacement capteur (unité)", 0.5],
    ["ENTR", "Révision complète 10 000 km", 1.5],
    ["CTRL", "Contrôle pré-visite technique", 0.5],
  ] as const;
  await adminDb.laborOperation.createMany({
    data: laborCatalog.map(([code, name, hours]) => ({
      organizationId: organization.id,
      code,
      name,
      standardHours: hours,
      rateType: "STANDARD" as const,
    })),
  });

  console.log("Seed — catalogue pièces (120 références)...");
  const partFamilies = [
    { prefix: "FLT-H", name: "Filtre à huile", category: "Filtration", price: 3500 },
    { prefix: "FLT-A", name: "Filtre à air", category: "Filtration", price: 5500 },
    { prefix: "FLT-C", name: "Filtre à carburant", category: "Filtration", price: 6500 },
    { prefix: "FLT-HB", name: "Filtre habitacle", category: "Filtration", price: 4500 },
    {
      prefix: "HU-5W30",
      name: "Huile moteur 5W30 (le litre)",
      category: "Lubrifiants",
      price: 4800,
    },
    {
      prefix: "HU-10W40",
      name: "Huile moteur 10W40 (le litre)",
      category: "Lubrifiants",
      price: 4200,
    },
    { prefix: "PLQ-AV", name: "Jeu de plaquettes avant", category: "Freinage", price: 18000 },
    { prefix: "PLQ-AR", name: "Jeu de plaquettes arrière", category: "Freinage", price: 16000 },
    { prefix: "DISQ", name: "Disque de frein (unité)", category: "Freinage", price: 22000 },
    { prefix: "BAT", name: "Batterie 12V", category: "Électricité", price: 45000 },
    { prefix: "BOUG", name: "Bougie d'allumage", category: "Moteur", price: 3200 },
    { prefix: "COUR", name: "Courroie accessoire", category: "Moteur", price: 12000 },
    { prefix: "AMOR", name: "Amortisseur (unité)", category: "Suspension", price: 35000 },
    { prefix: "PNEU", name: "Pneu 14-17 pouces", category: "Pneumatiques", price: 55000 },
    { prefix: "AMPO", name: "Ampoule phare", category: "Électricité", price: 2500 },
  ];
  const products: Prisma.ProductCreateManyInput[] = [];
  for (const family of partFamilies) {
    for (let i = 1; i <= 8; i++) {
      products.push({
        organizationId: organization.id,
        sku: `${family.prefix}-${String(i).padStart(2, "0")}`,
        name: `${family.name} — réf. ${i}`,
        brand: ["Bosch", "Valeo", "Mann Filter", "Total", "Michelin"][i % 5],
        category: family.category,
        unit: family.name.includes("litre") ? "litre" : "pièce",
        purchasePrice: Math.round(family.price * 0.7),
        averageCost: Math.round(family.price * 0.7),
        salePrice: family.price,
        vatRate: 18,
        minStock: 5,
        reorderQty: 20,
        defaultSupplierId: suppliers[i % suppliers.length]!.id,
      });
    }
  }
  await adminDb.product.createMany({ data: products });
  const createdProducts = await adminDb.product.findMany({
    where: { organizationId: organization.id },
  });

  console.log("Seed — stocks...");
  const stockRows: Prisma.StockLevelCreateManyInput[] = [];
  for (const product of createdProducts) {
    stockRows.push({
      organizationId: organization.id,
      siteId: siteYopougon.id,
      productId: product.id,
      onHand: 25,
    });
    stockRows.push({
      organizationId: organization.id,
      siteId: siteCocody.id,
      productId: product.id,
      onHand: 10,
    });
  }
  await adminDb.stockLevel.createMany({ data: stockRows });

  console.log("Seed — catalogue marques/modèles (RG-M02-20)...");
  // organizationId NULL = catalogue global seedé par la plateforme (lu directement via
  // adminDb, cf. commentaire schema.prisma sur VehicleMake/VehicleModel).
  for (const makeSpec of VEHICLE_MAKE_CATALOG) {
    const make = await adminDb.vehicleMake.create({
      data: { organizationId: null, name: makeSpec.name },
    });
    await adminDb.vehicleModel.createMany({
      data: makeSpec.models.map((model) => ({
        organizationId: null,
        makeId: make.id,
        name: model.name,
        defaultFuel: model.fuel,
        serviceIntervalKm: model.serviceIntervalKm,
        serviceIntervalMonths: model.serviceIntervalMonths,
      })),
    });
  }

  console.log("Seed — clients et véhicules (scénarios de démonstration)...");

  // Kouassi Jean-Marc — VT expire dans 15 jours
  const kouassi = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Jean-Marc",
      lastName: "Kouassi",
      displayName: "Kouassi Jean-Marc",
      phone: "+2250747218890",
      hasWhatsapp: true,
      commune: "Yopougon",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: kouassi.id,
      ...plateFields("2547 GH 01"),
      make: "Toyota",
      model: "Corolla",
      year: 2018,
      fuel: "PETROL",
      currentMileage: 62000,
      currentMileageAt: daysFrom(-10),
      inspectionLastDate: daysFrom(15 - 365),
      inspectionExpiryDate: daysFrom(15),
    },
  });

  // Bamba Aminata — révision dépassée au km estimé
  const bamba = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Aminata",
      lastName: "Bamba",
      displayName: "Bamba Aminata",
      phone: "+2250566341207",
      hasWhatsapp: true,
      commune: "Cocody",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: bamba.id,
      ...plateFields("8812 JK 01"),
      make: "Hyundai",
      model: "Tucson",
      year: 2020,
      fuel: "PETROL",
      currentMileage: 85000,
      currentMileageAt: daysFrom(-5),
      estimatedMileage: 85500,
      serviceIntervalKm: 10000,
      lastServiceDate: daysFrom(-200),
      lastServiceMileage: 70000,
      nextServiceDueDate: daysFrom(-20),
      nextServiceDueMileage: 80000,
    },
  });

  // SOTRA Logistique SARL — entreprise, créances en retard
  const sotra = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "COMPANY",
      companyName: "SOTRA Logistique SARL",
      displayName: "SOTRA Logistique SARL",
      phone: "+2252722415500",
      ncc: "9988776B",
      rccm: "CI-ABJ-2010-B-54321",
      paymentTermsDays: 30,
      creditLimit: 2_000_000,
      commune: "Marcory",
    },
  });
  const sotraVehicles = await Promise.all(
    [...Array(6)].flatMap((_, i) => [
      adminDb.vehicle.create({
        data: {
          organizationId: organization.id,
          customerId: sotra.id,
          ...plateFields(`${3000 + i} SV 01`),
          make: "Toyota",
          model: "Hilux",
          year: 2019 + (i % 4),
          fuel: "DIESEL",
          currentMileage: 40000 + i * 5000,
        },
      }),
      adminDb.vehicle.create({
        data: {
          organizationId: organization.id,
          customerId: sotra.id,
          ...plateFields(`${3100 + i} SV 01`),
          make: "Isuzu",
          model: "D-Max",
          year: 2019 + (i % 4),
          fuel: "DIESEL",
          currentMileage: 38000 + i * 4500,
        },
      }),
    ]),
  );

  // Koné Ibrahim — facture 185 000 FCFA, retard 12 j, promesse rompue
  const kone = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Ibrahim",
      lastName: "Koné",
      displayName: "Koné Ibrahim",
      phone: "+2250152770943",
      hasWhatsapp: true,
      commune: "Abobo",
    },
  });
  const koneVehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: kone.id,
      ...plateFields("4421 FD 01"),
      make: "Peugeot",
      model: "301",
      year: 2017,
      fuel: "PETROL",
      currentMileage: 97000,
    },
  });

  // Yao Adjoua Christelle — sans WhatsApp, VT expirée depuis 6 j
  const yao = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Adjoua Christelle",
      lastName: "Yao",
      displayName: "Yao Adjoua Christelle",
      phone: "+2250709883165",
      hasWhatsapp: false,
      commune: "Adjamé",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: yao.id,
      ...plateFields("1190 LM 01"),
      make: "Kia",
      model: "Picanto",
      year: 2021,
      fuel: "PETROL",
      currentMileage: 31000,
      inspectionLastDate: daysFrom(-6 - 365),
      inspectionExpiryDate: daysFrom(-6),
    },
  });

  // Traoré Moussa — a répondu STOP
  const traore = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Moussa",
      lastName: "Traoré",
      displayName: "Traoré Moussa",
      phone: "+2250544109238",
      hasWhatsapp: true,
      remindersConsent: false,
      optedOutAt: daysFrom(-40),
      commune: "Treichville",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: traore.id,
      ...plateFields("6630 HB 01"),
      make: "Mitsubishi",
      model: "L200",
      year: 2019,
      fuel: "DIESEL",
      currentMileage: 54000,
    },
  });
  await adminDb.optOut.create({
    data: {
      organizationId: organization.id,
      address: "+2250544109238",
      reason: "Réponse STOP reçue par WhatsApp",
    },
  });

  // Diabaté Awa — sans téléphone (relance impossible)
  const diabate = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "INDIVIDUAL",
      firstName: "Awa",
      lastName: "Diabaté",
      displayName: "Diabaté Awa",
      phone: null,
      commune: "Koumassi",
    },
  });
  await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: diabate.id,
      ...plateFields("7745 NP 01"),
      make: "Suzuki",
      model: "Swift",
      year: 2019,
      fuel: "PETROL",
      currentMileage: 46000,
    },
  });

  console.log("Seed — clients complémentaires (remplissage jusqu'à 40)...");
  const fillerCustomers: { id: string }[] = [];
  for (let i = 0; i < 33; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 3 + 1) % LAST_NAMES.length];
    const customer = await adminDb.customer.create({
      data: {
        organizationId: organization.id,
        type: "INDIVIDUAL",
        firstName,
        lastName,
        displayName: `${lastName} ${firstName}`,
        phone: phoneFor(i),
        hasWhatsapp: i % 4 !== 0,
        commune: COMMUNES[i % COMMUNES.length],
      },
    });
    const vehicleSpec = VEHICLE_CATALOG[i % VEHICLE_CATALOG.length]!;
    await adminDb.vehicle.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        ...plateFields(plateFor(i + 400)),
        make: vehicleSpec.make,
        model: vehicleSpec.model,
        year: 2015 + (i % 10),
        fuel: vehicleSpec.fuel,
        currentMileage: 20000 + i * 3100,
        currentMileageAt: daysFrom(-i),
      },
    });
    fillerCustomers.push(customer);
  }

  console.log("Seed — rendez-vous et planning (M03)...");
  // Jours ouvrés à venir (lun-sam, Abidjan = UTC+0) : J+1, J+2, J+7 — jamais un dimanche.
  function nextWorkingDay(from: Date, offset: number): Date {
    const date = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset),
    );
    while (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }
  function atTime(day: Date, time: string): Date {
    const [h, m] = time.split(":").map(Number);
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
  }
  const today = new Date();
  const kouassiVehicle = await adminDb.vehicle.findFirstOrThrow({
    where: { customerId: kouassi.id },
  });
  const bambaVehicle = await adminDb.vehicle.findFirstOrThrow({ where: { customerId: bamba.id } });
  const mechanicMembershipId = memberships.MECHANIC!.membershipId;
  const demoAppointments: Array<{
    customerId: string;
    vehicleId: string | null;
    day: Date;
    time: string;
    minutes: number;
    type: Prisma.AppointmentCreateInput["type"];
    status: Prisma.AppointmentCreateInput["status"];
    source: Prisma.AppointmentCreateInput["source"];
    bayId: string | null;
    mechanicId?: string | null;
    complaint?: string;
  }> = [
    // Aujourd'hui : un RDV confirmé ce matin (arrivé), un réservé cet après-midi, un absent hier.
    {
      customerId: kouassi.id,
      vehicleId: kouassiVehicle.id,
      day: nextWorkingDay(today, 0),
      time: "09:00",
      minutes: 90,
      type: "INSPECTION_PREP",
      status: "CONFIRMED",
      source: "REMINDER",
      bayId: baysYopougon[0]!.id,
      mechanicId: mechanicMembershipId,
      complaint: "Pré-visite technique avant VT du mois prochain",
    },
    {
      customerId: bamba.id,
      vehicleId: bambaVehicle.id,
      day: nextWorkingDay(today, 0),
      time: "14:00",
      minutes: 120,
      type: "REPAIR",
      status: "BOOKED",
      source: "PHONE",
      bayId: baysYopougon[1]!.id,
      complaint: "Bruit au freinage",
    },
    {
      customerId: fillerCustomers[0]!.id,
      vehicleId: null,
      day: nextWorkingDay(today, -1),
      time: "10:00",
      minutes: 60,
      type: "DIAGNOSTIC",
      status: "NO_SHOW",
      source: "WHATSAPP",
      bayId: baysYopougon[2]!.id,
    },
    // Demain et J+2 : portail et comptoir.
    {
      customerId: fillerCustomers[1]!.id,
      vehicleId: null,
      day: nextWorkingDay(today, 1),
      time: "08:00",
      minutes: 90,
      type: "SERVICE",
      status: "CONFIRMED",
      source: "PORTAL",
      bayId: null,
    },
    {
      customerId: fillerCustomers[2]!.id,
      vehicleId: null,
      day: nextWorkingDay(today, 1),
      time: "10:30",
      minutes: 45,
      type: "TIRES",
      status: "BOOKED",
      source: "STAFF",
      bayId: baysYopougon[0]!.id,
    },
    {
      customerId: fillerCustomers[3]!.id,
      vehicleId: null,
      day: nextWorkingDay(today, 2),
      time: "15:00",
      minutes: 60,
      type: "OTHER",
      status: "BOOKED",
      source: "STAFF",
      bayId: baysYopougon[3]!.id,
    },
  ];
  for (const spec of demoAppointments) {
    const startsAt = atTime(spec.day, spec.time);
    await adminDb.appointment.create({
      data: {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        customerId: spec.customerId,
        vehicleId: spec.vehicleId,
        bayId: spec.bayId,
        mechanicId: spec.mechanicId ?? null,
        advisorId: advisorMembershipId,
        createdById: advisorMembershipId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + spec.minutes * 60_000),
        type: spec.type,
        status: spec.status,
        source: spec.source,
        complaint: spec.complaint ?? null,
        confirmedAt: spec.status === "CONFIRMED" ? daysFrom(-1) : null,
        confirmedVia:
          spec.status === "CONFIRMED" ? (spec.source === "PORTAL" ? "portal" : "whatsapp") : null,
        noShowAt: spec.status === "NO_SHOW" ? atTime(spec.day, "20:00") : null,
      },
    });
  }
  // RDV groupés flotte SOTRA (RG-M03-14) : 4 véhicules, 2 en parallèle, la semaine prochaine.
  const fleetDay = nextWorkingDay(today, 7);
  const fleetGroupId = `grp_seed_${organization.id.slice(0, 6)}`;
  for (let i = 0; i < 4; i++) {
    const startsAt = atTime(fleetDay, i < 2 ? "08:00" : "09:00");
    await adminDb.appointment.create({
      data: {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        customerId: sotra.id,
        vehicleId: sotraVehicles[i]!.id,
        bayId: baysYopougon[i % 2]!.id,
        advisorId: advisorMembershipId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        type: "INSPECTION_PREP",
        status: "BOOKED",
        source: "STAFF",
        groupId: fleetGroupId,
      },
    });
  }
  // Blocage : Pont 2 en maintenance deux jours la semaine prochaine (US-M03-10).
  const maintenanceDay = nextWorkingDay(today, 8);
  await adminDb.resourceBlock.create({
    data: {
      organizationId: organization.id,
      siteId: siteYopougon.id,
      bayId: baysYopougon[1]!.id,
      startsAt: atTime(maintenanceDay, "07:30"),
      endsAt: atTime(nextWorkingDay(maintenanceDay, 1), "18:00"),
      reason: "Maintenance pont",
      createdById: memberships.MANAGER!.membershipId,
    },
  });

  console.log("Seed — documents fiscaux : créances SOTRA et Koné...");
  // Numérotation manuelle de démonstration : la logique définitive (sans trou, par
  // organisation pour les documents fiscaux) arrive avec packages/core (Étape 0.3).
  let invoiceSeq = 1;
  const nextInvoiceNumber = () => `FAC-2026-${String(invoiceSeq++).padStart(6, "0")}`;

  const sotraInvoiceAmounts = [450_000, 430_000, 360_000]; // total 1 240 000 FCFA
  for (const [i, amount] of sotraInvoiceAmounts.entries()) {
    const vehicle = sotraVehicles[i]!;
    const dueDate = daysFrom(-38);
    const invoice = await adminDb.invoice.create({
      data: {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        number: nextInvoiceNumber(),
        type: "INVOICE",
        status: "OVERDUE",
        customerId: sotra.id,
        vehicleId: vehicle.id,
        billTo: "CUSTOMER",
        issuedAt: daysFrom(-38 - 30),
        dueDate,
        subtotal: Math.round(amount / 1.18),
        vatTotal: amount - Math.round(amount / 1.18),
        total: amount,
        amountPaid: 0,
        balance: amount,
        createdById: advisorMembershipId,
      },
    });
    await adminDb.invoiceLine.create({
      data: {
        organizationId: organization.id,
        invoiceId: invoice.id,
        type: "LABOR",
        description: "Entretien flotte — forfait",
        quantity: 1,
        unitPrice: Math.round(amount / 1.18),
        vatRate: 18,
        lineSubtotal: Math.round(amount / 1.18),
        lineVat: amount - Math.round(amount / 1.18),
        lineTotal: amount,
      },
    });
  }

  const koneAmount = 185_000;
  const koneInvoice = await adminDb.invoice.create({
    data: {
      organizationId: organization.id,
      siteId: siteYopougon.id,
      number: nextInvoiceNumber(),
      type: "INVOICE",
      status: "OVERDUE",
      customerId: kone.id,
      vehicleId: koneVehicle.id,
      billTo: "CUSTOMER",
      issuedAt: daysFrom(-12 - 30),
      dueDate: daysFrom(-12),
      subtotal: Math.round(koneAmount / 1.18),
      vatTotal: koneAmount - Math.round(koneAmount / 1.18),
      total: koneAmount,
      amountPaid: 0,
      balance: koneAmount,
      createdById: advisorMembershipId,
    },
  });
  await adminDb.invoiceLine.create({
    data: {
      organizationId: organization.id,
      invoiceId: koneInvoice.id,
      type: "PART",
      description: "Réparation suspension + main-d'œuvre",
      quantity: 1,
      unitPrice: Math.round(koneAmount / 1.18),
      vatRate: 18,
      lineSubtotal: Math.round(koneAmount / 1.18),
      lineVat: koneAmount - Math.round(koneAmount / 1.18),
      lineTotal: koneAmount,
    },
  });

  const koneCase = await adminDb.collectionCase.create({
    data: {
      organizationId: organization.id,
      customerId: kone.id,
      status: "OPEN",
      stage: 2,
      totalDue: koneAmount,
      oldestDueDate: daysFrom(-12),
      nextActionAt: daysFrom(1),
    },
  });
  await adminDb.paymentPromise.create({
    data: {
      organizationId: organization.id,
      collectionCaseId: koneCase.id,
      amount: koneAmount,
      promisedDate: daysFrom(-5),
      channel: "téléphone",
      status: "BROKEN",
      createdById: advisorMembershipId,
    },
  });
  await adminDb.collectionNote.create({
    data: {
      organizationId: organization.id,
      collectionCaseId: koneCase.id,
      body:
        "Client contacté par téléphone le " +
        daysFrom(-5).toISOString().slice(0, 10) +
        " : a promis un règlement sous 48h. Promesse non tenue.",
      type: "call",
      createdById: advisorMembershipId,
    },
  });

  console.log("Seed — historique (12 mois, 24 ordres de réparation facturés et payés)...");
  const orSeqBySite: Record<string, number> = { [siteYopougon.id]: 1, [siteCocody.id]: 1 };
  let receiptSeq = 1;
  for (let m = 0; m < 12; m++) {
    for (let k = 0; k < 2; k++) {
      const customer = fillerCustomers[(m * 2 + k) % fillerCustomers.length]!;
      const vehicle = await adminDb.vehicle.findFirst({ where: { customerId: customer.id } });
      if (!vehicle) continue;
      const createdAt = daysFrom(-(365 - m * 30 - k * 10));
      const amount = 35_000 + ((m * 2 + k) % 6) * 15_000;
      const site = k === 1 ? siteCocody : siteYopougon;
      const bays = k === 1 ? baysCocody : baysYopougon;

      const repairOrder = await adminDb.repairOrder.create({
        data: {
          organizationId: organization.id,
          siteId: site.id,
          number: `OR-${site.code}-2026-${String(orSeqBySite[site.id]!++).padStart(5, "0")}`,
          customerId: customer.id,
          vehicleId: vehicle.id,
          advisorId: advisorMembershipId,
          bayId: bays[m % bays.length]!.id,
          status: "INVOICED",
          mileageIn: vehicle.currentMileage ?? 50000,
          complaint: "Entretien périodique",
          startedAt: createdAt,
          completedAt: createdAt,
          deliveredAt: createdAt,
          totalEstimate: amount,
          createdAt,
        },
      });

      const invoice = await adminDb.invoice.create({
        data: {
          organizationId: organization.id,
          siteId: site.id,
          number: nextInvoiceNumber(),
          type: "INVOICE",
          status: "PAID",
          customerId: customer.id,
          vehicleId: vehicle.id,
          repairOrderId: repairOrder.id,
          billTo: "CUSTOMER",
          issuedAt: createdAt,
          dueDate: createdAt,
          subtotal: Math.round(amount / 1.18),
          vatTotal: amount - Math.round(amount / 1.18),
          total: amount,
          amountPaid: amount,
          balance: 0,
          createdById: advisorMembershipId,
          createdAt,
        },
      });

      await adminDb.payment.create({
        data: {
          organizationId: organization.id,
          siteId: site.id,
          customerId: customer.id,
          number: `REC-2026-${String(receiptSeq++).padStart(6, "0")}`,
          method: "CASH",
          amount,
          receivedAt: createdAt,
          receivedById: cashierMembershipId,
          createdAt,
        },
      });
      void invoice;
    }
  }

  console.log("Seed — compteurs de numérotation (DocumentSequence)...");
  await adminDb.documentSequence.createMany({
    data: [
      {
        organizationId: organization.id,
        siteId: null,
        docType: "FAC",
        year: 2026,
        lastValue: invoiceSeq - 1,
      },
      {
        organizationId: organization.id,
        siteId: null,
        docType: "REC",
        year: 2026,
        lastValue: receiptSeq - 1,
      },
      {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        docType: "OR",
        year: 2026,
        lastValue: orSeqBySite[siteYopougon.id]! - 1,
      },
      {
        organizationId: organization.id,
        siteId: siteCocody.id,
        docType: "OR",
        year: 2026,
        lastValue: orSeqBySite[siteCocody.id]! - 1,
      },
    ],
  });

  console.log(
    `Seed terminé : organisation "${organization.name}" (${organization.id}), ` +
      `${1 + 1 + 1 + 1 + 1 + 1 + 1 + fillerCustomers.length} clients, ${createdProducts.length} produits.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
