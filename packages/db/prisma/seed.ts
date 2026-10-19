import {
  defaultInspectionTemplate,
  defaultMessageTemplates,
  defaultReminderRules,
  extraInspectionTemplates,
  generateCiHolidays,
  hashPassword,
  lineAmounts,
  normalizePlate,
} from "@atelieros/core";
import { adminDb } from "../src/client";
import { Prisma } from "@prisma/client";

// RG-M02-05 — plateCompact doit être renseigné dès la création (unicité partielle
// vehicle_plate_unique sur organizationId+plateCompact, migration 20261019012546).
function plateCompactOf(plate: string): string {
  return normalizePlate(plate).plateCompact;
}

// Le seed doit être rejouable (CLAUDE.md "Commandes" : `pnpm db:seed`) : organization.delete()
// seul ne cascade pas vers les tables tenant-scopées (pas de onDelete: Cascade sur chacune),
// donc on purge nous-mêmes toutes les tables portant organizationId avant de supprimer
// l'organisation, en désactivant temporairement les triggers de contrainte FK (connexion
// superutilisateur adminDb, réservée à l'infra) plutôt que de deviner un ordre de dépendances.
async function deleteOrganizationCascade(organizationId: string): Promise<void> {
  const tenantModels = Prisma.dmmf.datamodel.models.filter(
    (model) =>
      model.name !== "Organization" &&
      model.fields.some((field) => field.name === "organizationId"),
  );
  await adminDb.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET session_replication_role = replica");
    for (const model of tenantModels) {
      await tx.$executeRawUnsafe(
        `DELETE FROM "${model.dbName ?? model.name}" WHERE "organizationId" = $1`,
        organizationId,
      );
    }
    await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', organizationId);
    await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
  });
}

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

function plateFor(index: number): string {
  const letters = ["AB", "CD", "EF", "GH", "JK", "LM", "FD", "HB", "NP", "RS"];
  const letter = letters[index % letters.length];
  const num = 1000 + index;
  return `${num} ${letter} 01`;
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
    // User est global (pas de organizationId) : un compte démo recréé avec le même email
    // entrerait en conflit si on ne le supprime pas ici (ses Membership disparaissent avec
    // la cascade ci-dessous, mais pas la ligne User elle-même).
    const previousMembers = await adminDb.membership.findMany({
      where: { organizationId: existing.id },
      select: { userId: true },
    });
    await deleteOrganizationCascade(existing.id);
    await adminDb.user.deleteMany({ where: { id: { in: previousMembers.map((m) => m.userId) } } });
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
      // Garage de démo déjà configuré : l'espace applicatif ne renvoie pas vers /bienvenue.
      onboardingCompletedAt: new Date(),
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

  console.log("Seed — canaux de messagerie (ChannelConfig, M10/M11)...");
  // CLAUDE.md « Fournisseurs externes » : provider "console" (packages/integrations) pour que
  // les relances fonctionnent en local/démo sans compte fournisseur réel.
  await adminDb.channelConfig.createMany({
    data: (["WHATSAPP", "SMS", "EMAIL"] as const).map((channel) => ({
      organizationId: organization.id,
      channel,
      provider: "console",
      isActive: true,
      priority: 1,
      credentials: "",
    })),
  });

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
      plate: "2547 GH 01",
      plateCompact: plateCompactOf("2547 GH 01"),
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
      plate: "8812 JK 01",
      plateCompact: plateCompactOf("8812 JK 01"),
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
          plate: `${3000 + i} SV 01`,
          plateCompact: plateCompactOf(`${3000 + i} SV 01`),
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
          plate: `${3100 + i} SV 01`,
          plateCompact: plateCompactOf(`${3100 + i} SV 01`),
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
      plate: "4421 FD 01",
      plateCompact: plateCompactOf("4421 FD 01"),
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
      plate: "1190 LM 01",
      plateCompact: plateCompactOf("1190 LM 01"),
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
      plate: "6630 HB 01",
      plateCompact: plateCompactOf("6630 HB 01"),
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
      plate: "7745 NP 01",
      plateCompact: plateCompactOf("7745 NP 01"),
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
        plate: plateFor(i + 400),
        plateCompact: plateCompactOf(plateFor(i + 400)),
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

  console.log("Seed — dossier de recouvrement SOTRA (CollectionCase, RG-M10-01 RECEIVABLE)...");
  // SOTRA a 3 factures en retard (total ci-dessus) mais aucun contact encore effectué :
  // stage 1 (vs. stage 2 pour Koné, qui a déjà eu un appel et une promesse rompue). Sans ce
  // dossier, le moteur M10 ne peut pas planifier de relance RECEIVABLE pour ce client.
  const sotraCase = await adminDb.collectionCase.create({
    data: {
      organizationId: organization.id,
      customerId: sotra.id,
      status: "OPEN",
      stage: 1,
      totalDue: 1_240_000,
      oldestDueDate: daysFrom(-38),
      // M09 §14 : ancre figée de la séquence, part échue, retard max.
      anchorDate: daysFrom(-38),
      overdueDue: 1_240_000,
      maxDaysOverdue: 38,
      nextActionAt: daysFrom(1),
    },
  });
  await adminDb.collectionNote.create({
    data: {
      organizationId: organization.id,
      collectionCaseId: sotraCase.id,
      body: "3 factures impayées (450 000 + 430 000 + 360 000 FCFA), 38 jours de retard, dossier ouvert automatiquement.",
      type: "note",
      createdById: advisorMembershipId,
    },
  });

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
      anchorDate: daysFrom(-12),
      overdueDue: koneAmount,
      maxDaysOverdue: 12,
      brokenPromiseCount: 1,
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
      callOutcome: "REACHED",
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

  console.log("Seed — modèles de message par défaut (MessageTemplate, Annexe A de M10)...");
  // Source unique partagée avec l'onboarding (RG-M01-16) : packages/core/src/onboarding/
  // reminder-defaults.ts (transcription de l'Annexe A de M10 et des règles RG-M10-02).
  await adminDb.messageTemplate.createMany({
    data: defaultMessageTemplates().map((t) => ({
      organizationId: organization.id,
      key: t.key,
      name: t.name,
      channel: t.channel,
      subject: t.subject,
      body: t.body,
      type: t.type,
      isActive: true,
      isDefault: true,
    })),
  });

  console.log("Seed — règles de relance par défaut (ReminderRule, RG-M10-02)...");
  await adminDb.reminderRule.createMany({
    data: defaultReminderRules().map((rule) => ({
      organizationId: organization.id,
      type: rule.type,
      name: rule.name,
      isActive: rule.isActive,
      steps: rule.steps as unknown as Prisma.InputJsonValue,
      sendWindow: rule.sendWindow as unknown as Prisma.InputJsonValue,
      conditions: rule.conditions as Prisma.InputJsonValue,
      stopOn: rule.stopOn,
    })),
  });

  console.log("Seed — rendez-vous de démonstration (M03)...");
  // Prochain jour ouvré (lun-sam) à au moins 1 jour, puis le suivant : planning non vide en démo.
  const demoDays: Date[] = [];
  for (let offset = 1; demoDays.length < 2; offset++) {
    const d = daysFrom(offset);
    if (d.getUTCDay() !== 0) demoDays.push(d);
  }
  const at = (day: Date, hours: number, minutes = 0) =>
    new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours, minutes));
  const kouassiCar = await adminDb.vehicle.findFirstOrThrow({ where: { customerId: kouassi.id } });
  const bambaCar = await adminDb.vehicle.findFirstOrThrow({ where: { customerId: bamba.id } });
  const demoAppointments = [
    {
      customerId: kouassi.id,
      vehicleId: kouassiCar.id,
      bay: 0,
      start: at(demoDays[0]!, 9),
      minutes: 90,
      type: "SERVICE",
      status: "CONFIRMED",
      source: "PHONE",
    },
    {
      customerId: bamba.id,
      vehicleId: bambaCar.id,
      bay: 1,
      start: at(demoDays[0]!, 11),
      minutes: 60,
      type: "INSPECTION_PREP",
      status: "BOOKED",
      source: "REMINDER",
    },
    {
      customerId: kouassi.id,
      vehicleId: null,
      bay: null,
      start: at(demoDays[1]!, 14),
      minutes: 60,
      type: "DIAGNOSTIC",
      status: "BOOKED",
      source: "WHATSAPP",
    },
  ] as const;
  for (const a of demoAppointments) {
    await adminDb.appointment.create({
      data: {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        customerId: a.customerId,
        vehicleId: a.vehicleId,
        bayId: a.bay === null ? null : baysYopougon[a.bay]!.id,
        advisorId: advisorMembershipId,
        startsAt: a.start,
        endsAt: new Date(a.start.getTime() + a.minutes * 60_000),
        type: a.type,
        status: a.status,
        source: a.source,
        ...(a.status === "CONFIRMED" ? { confirmedAt: new Date(), confirmedVia: "phone" } : {}),
      },
    });
  }

  console.log("Seed — modèles d'inspection et OR en cours (M04)...");
  await adminDb.inspectionTemplate.create({
    data: {
      organizationId: organization.id,
      name: defaultInspectionTemplate().name,
      items: defaultInspectionTemplate().items as unknown as Prisma.InputJsonValue,
      isDefault: true,
    },
  });
  for (const template of extraInspectionTemplates()) {
    await adminDb.inspectionTemplate.create({
      data: {
        organizationId: organization.id,
        name: template.name,
        items: template.items as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const mechanicMembershipId = memberships.MECHANIC!.membershipId;
  const managerMembershipId = memberships.MANAGER!.membershipId;
  const activeScenarios: Array<{
    status: "CHECKED_IN" | "IN_PROGRESS" | "AWAITING_APPROVAL" | "READY";
    complaint: string;
    promisedInHours: number;
    path: Array<
      | "CHECKED_IN"
      | "DIAGNOSING"
      | "AWAITING_APPROVAL"
      | "APPROVED"
      | "IN_PROGRESS"
      | "QUALITY_CHECK"
      | "READY"
    >;
    lines: Array<{
      type: "LABOR" | "PART";
      description: string;
      quantity: number;
      unitPrice: number;
      approval: "APPROVED" | "PENDING";
      status: "PENDING" | "IN_PROGRESS" | "DONE";
    }>;
  }> = [
    {
      status: "CHECKED_IN",
      complaint: "Bruit moteur à froid + voyant moteur allumé",
      promisedInHours: 6,
      path: ["CHECKED_IN"],
      lines: [],
    },
    {
      status: "IN_PROGRESS",
      complaint: "Vidange + bruit au freinage à l'avant",
      promisedInHours: -3,
      path: ["CHECKED_IN", "APPROVED", "IN_PROGRESS"],
      lines: [
        {
          type: "LABOR",
          description: "Vidange moteur + filtre",
          quantity: 0.5,
          unitPrice: 15_000,
          approval: "APPROVED",
          status: "DONE",
        },
        {
          type: "PART",
          description: "Huile moteur 5W30 (le litre)",
          quantity: 4,
          unitPrice: 4_800,
          approval: "APPROVED",
          status: "DONE",
        },
        {
          type: "LABOR",
          description: "Remplacement plaquettes AV",
          quantity: 1,
          unitPrice: 15_000,
          approval: "APPROVED",
          status: "IN_PROGRESS",
        },
      ],
    },
    {
      status: "AWAITING_APPROVAL",
      complaint: "Claquements dans les bosses",
      promisedInHours: 24,
      path: ["CHECKED_IN", "DIAGNOSING", "AWAITING_APPROVAL"],
      lines: [
        {
          type: "LABOR",
          description: "Diagnostic trains roulants",
          quantity: 1,
          unitPrice: 20_000,
          approval: "APPROVED",
          status: "DONE",
        },
        {
          type: "PART",
          description: "Amortisseurs arrière (paire)",
          quantity: 1,
          unitPrice: 85_000,
          approval: "PENDING",
          status: "PENDING",
        },
        {
          type: "LABOR",
          description: "Remplacement amortisseurs AR",
          quantity: 2,
          unitPrice: 15_000,
          approval: "PENDING",
          status: "PENDING",
        },
      ],
    },
    {
      status: "READY",
      complaint: "Climatisation ne refroidit plus",
      promisedInHours: -26,
      path: ["CHECKED_IN", "APPROVED", "IN_PROGRESS", "QUALITY_CHECK", "READY"],
      lines: [
        {
          type: "LABOR",
          description: "Recharge climatisation",
          quantity: 1,
          unitPrice: 25_000,
          approval: "APPROVED",
          status: "DONE",
        },
      ],
    },
  ];
  for (const [index, scenario] of activeScenarios.entries()) {
    const customer = fillerCustomers[(index * 5 + 3) % fillerCustomers.length]!;
    const vehicle = await adminDb.vehicle.findFirst({ where: { customerId: customer.id } });
    if (!vehicle) continue;
    const receivedAt = new Date(TODAY.getTime() - (index + 1) * 3 * 3_600_000);
    const totalEstimate = scenario.lines
      .filter((l) => l.approval === "APPROVED")
      .reduce(
        (sum, l) =>
          sum + lineAmounts({ ...l, discountRate: 0, vatRate: 18, payer: "CUSTOMER" }).total,
        0,
      );
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: organization.id,
        siteId: siteYopougon.id,
        number: `OR-${siteYopougon.code}-2026-${String(orSeqBySite[siteYopougon.id]!++).padStart(5, "0")}`,
        customerId: customer.id,
        vehicleId: vehicle.id,
        advisorId: advisorMembershipId,
        createdById: advisorMembershipId,
        status: scenario.status,
        mileageIn: vehicle.currentMileage ?? 50_000,
        fuelLevel: 4,
        complaint: scenario.complaint,
        checkIn: {
          bodyType: "SEDAN",
          noDamage: true,
          damages: [],
          items: [{ key: "spare_wheel", present: true }],
          keysCount: 1,
          belongings: "",
          warningLights: [],
          authorizationCeiling: 25_000,
          returnOldParts: false,
          dropOff: { by: "OWNER" },
          photoAttachmentIds: [],
        },
        signedAt: receivedAt,
        promisedAt: new Date(TODAY.getTime() + scenario.promisedInHours * 3_600_000),
        startedAt: scenario.path.includes("IN_PROGRESS") ? receivedAt : null,
        readyAt: scenario.status === "READY" ? new Date(TODAY.getTime() - 2 * 86_400_000) : null,
        qcById: scenario.status === "READY" ? managerMembershipId : null,
        qcAt: scenario.status === "READY" ? receivedAt : null,
        totalEstimate,
        createdAt: receivedAt,
      },
    });
    let from: (typeof scenario.path)[number] | "DRAFT" = "DRAFT";
    for (const to of scenario.path) {
      await adminDb.repairOrderStatusHistory.create({
        data: {
          organizationId: organization.id,
          repairOrderId: order.id,
          fromStatus: from,
          toStatus: to,
          transition: to === "CHECKED_IN" ? "check_in" : "seed",
          membershipId: advisorMembershipId,
          createdAt: receivedAt,
        },
      });
      from = to;
    }
    for (const [sortOrder, line] of scenario.lines.entries()) {
      await adminDb.repairOrderLine.create({
        data: {
          organizationId: organization.id,
          repairOrderId: order.id,
          ...line,
          vatRate: 18,
          approvalSource: line.approval === "APPROVED" ? "CHECK_IN" : null,
          assignedToId: line.type === "LABOR" ? mechanicMembershipId : null,
          sortOrder,
        },
      });
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

  // RG-M02-20 — catalogue marques/modèles global (organizationId null), avec intervalle de
  // révision par défaut. Les modèles d'une organisation peuvent être ajoutés en plus via
  // catalog.addLocalModel ; voir docs/modules/M02-clients-vehicules.md §4.
  const MAKE_MODEL_CATALOG: Record<
    string,
    { name: string; serviceIntervalKm?: number; serviceIntervalMonths?: number }[]
  > = {
    Toyota: [
      { name: "Corolla", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Hilux", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Land Cruiser", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "RAV4", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Yaris", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Hyundai: [
      { name: "Tucson", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Accent", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "i10", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Kia: [
      { name: "Picanto", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Sportage", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Rio", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Nissan: [
      { name: "Navara", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Patrol", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Sentra", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Mitsubishi: [
      { name: "L200", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Pajero", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Suzuki: [
      { name: "Swift", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Vitara", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Isuzu: [{ name: "D-Max", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Peugeot: [
      { name: "301", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "208", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Renault: [
      { name: "Duster", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
      { name: "Logan", serviceIntervalKm: 10000, serviceIntervalMonths: 12 },
    ],
    Citroën: [{ name: "C3", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    "Mercedes-Benz": [{ name: "Classe C", serviceIntervalKm: 15000, serviceIntervalMonths: 12 }],
    BMW: [{ name: "Série 3", serviceIntervalKm: 15000, serviceIntervalMonths: 12 }],
    Ford: [{ name: "Ranger", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Honda: [{ name: "CR-V", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Mazda: [{ name: "CX-5", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Volkswagen: [{ name: "Polo", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    "Land Rover": [{ name: "Defender", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Chevrolet: [{ name: "Aveo", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Changan: [{ name: "CS35", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Geely: [{ name: "Coolray", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Chery: [{ name: "Tiggo", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Dongfeng: [{ name: "AX7", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    "Great Wall": [{ name: "Wingle", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    JAC: [{ name: "T6", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
    Tata: [{ name: "Xenon", serviceIntervalKm: 10000, serviceIntervalMonths: 12 }],
  };

  // findFirst + create plutôt qu'upsert : le sélecteur composé généré par Prisma pour
  // @@unique([organizationId, name]) n'accepte pas organizationId: null (la contrainte
  // Postgres elle-même traite les NULL comme toujours distincts), bien que le champ soit
  // nullable sur le modèle (catalogue global, RG-M02-20).
  for (const [makeName, models] of Object.entries(MAKE_MODEL_CATALOG)) {
    let make = await adminDb.vehicleMake.findFirst({
      where: { organizationId: null, name: makeName },
    });
    if (!make) {
      make = await adminDb.vehicleMake.create({ data: { organizationId: null, name: makeName } });
    }
    for (const model of models) {
      const existingModel = await adminDb.vehicleModel.findFirst({
        where: { makeId: make.id, organizationId: null, name: model.name },
      });
      if (!existingModel) {
        await adminDb.vehicleModel.create({
          data: {
            organizationId: null,
            makeId: make.id,
            name: model.name,
            serviceIntervalKm: model.serviceIntervalKm,
            serviceIntervalMonths: model.serviceIntervalMonths,
          },
        });
      }
    }
  }

  console.log(
    `Seed terminé : organisation "${organization.name}" (${organization.id}), ` +
      `${1 + 1 + 1 + 1 + 1 + 1 + 1 + fillerCustomers.length} clients, ${createdProducts.length} produits, ` +
      `${Object.keys(MAKE_MODEL_CATALOG).length} marques au catalogue, ` +
      `${defaultMessageTemplates().length} modèles de message et ${defaultReminderRules().length} règles de relance (M10) par défaut.`,
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
