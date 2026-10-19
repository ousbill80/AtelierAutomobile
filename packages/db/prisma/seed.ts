import { generateCiHolidays, hashPassword, normalizePlate } from "@atelieros/core";
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

  console.log("Seed — modèles de message par défaut (MessageTemplate, Annexe A de M10)...");
  // Transcription fidèle de docs/modules/M10-relances-automatiques.md, Annexe A (§ "Modèles
  // par défaut livrés"). Les placeholders {{...}} sont repris tels quels : ils sont résolus
  // par le moteur de rendu (M11), pas par ce seed. Une ligne par canal supporté par le modèle
  // (certains, ex. rdv_hm2, n'ont pas de variante Email — "non utilisé" dans le PRD).
  type TemplateChannel = "WHATSAPP" | "SMS" | "EMAIL";
  interface TemplateRow {
    key: string;
    name: string;
    channel: TemplateChannel;
    subject?: string;
    body: string;
    type?: Prisma.MessageTemplateCreateManyInput["type"];
  }
  const messageTemplates: TemplateRow[] = [
    // A.1 Visite technique
    {
      key: "vt_j30",
      name: "Visite technique — J-30",
      channel: "WHATSAPP",
      type: "INSPECTION",
      body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. {{garage.nom}} vous propose une pré-visite pour passer le contrôle sans surprise. Répondez à ce message ou appelez le {{garage.telephone}} pour réserver.",
    },
    {
      key: "vt_j30",
      name: "Visite technique — J-30",
      channel: "SMS",
      type: "INSPECTION",
      body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. Pre-visite: {{garage.telephone}}",
    },
    {
      key: "vt_j30",
      name: "Visite technique — J-30",
      channel: "EMAIL",
      type: "INSPECTION",
      subject:
        "Visite technique de votre {{vehicule.marque}} {{vehicule.modele}} : expiration le {{vt.dateExpiration}}",
      body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} immatriculé {{vehicule.plaque}} expire le {{vt.dateExpiration}}.\nNous vous proposons une pré-visite : nous contrôlons les points vérifiés au centre (freins, éclairage, pneus, émissions) et corrigeons ce qui doit l'être, pour réussir la visite du premier coup.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}} — {{garage.adresse}} — {{garage.horaires}}",
    },
    {
      key: "vt_j7",
      name: "Visite technique — J-7",
      channel: "WHATSAPP",
      type: "INSPECTION",
      body: "Bonjour {{client.salutation}}, plus que {{vt.joursRestants}} jours : la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}. Nous pouvons vous recevoir cette semaine pour la pré-visite. Quel jour vous arrange ? {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "vt_j7",
      name: "Visite technique — J-7",
      channel: "SMS",
      type: "INSPECTION",
      body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{vt.dateExpiration}}. RDV cette semaine: {{garage.telephone}}",
    },
    {
      key: "vt_j7",
      name: "Visite technique — J-7",
      channel: "EMAIL",
      type: "INSPECTION",
      subject: "Plus que {{vt.joursRestants}} jours avant l'expiration de votre visite technique",
      body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}, dans {{vt.joursRestants}} jours.\nNous pouvons encore vous recevoir cette semaine pour une pré-visite. Réservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
    },
    {
      key: "vt_j0",
      name: "Visite technique — J0",
      channel: "WHATSAPP",
      type: "INSPECTION",
      body: "Bonjour {{client.salutation}}, la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire aujourd'hui, le {{vt.dateExpiration}}. Si ce n'est pas encore fait, passez nous voir : nous vous aidons à la faire rapidement. {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "vt_j0",
      name: "Visite technique — J0",
      channel: "SMS",
      type: "INSPECTION",
      body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} expire aujourd'hui. Passez nous voir. Tel {{garage.telephone}}",
    },
    {
      key: "vt_j0",
      name: "Visite technique — J0",
      channel: "EMAIL",
      type: "INSPECTION",
      subject: "Votre visite technique expire aujourd'hui",
      body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire aujourd'hui. Si vous l'avez déjà faite, ignorez ce message ou indiquez-nous la nouvelle date pour mettre votre dossier à jour.\nSinon, contactez-nous au {{garage.telephone}} : nous préparons votre véhicule en priorité.\n{{garage.nom}}",
    },
    {
      key: "vt_jp7",
      name: "Visite technique — J+7",
      channel: "WHATSAPP",
      type: "INSPECTION",
      body: "Bonjour {{client.salutation}}, selon nos informations la visite technique de votre {{vehicule.marque}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}. Si elle a été faite, envoyez-nous simplement la nouvelle date. Sinon, nous pouvons préparer votre véhicule rapidement : {{garage.telephone}}. {{garage.nom}}",
    },
    {
      key: "vt_jp7",
      name: "Visite technique — J+7",
      channel: "SMS",
      type: "INSPECTION",
      body: "{{garage.nom}}: {{client.salutation}}, la visite technique de votre {{vehicule.marque}} {{vehicule.plaque}} a expiré le {{vt.dateExpiration}}. On vous aide: {{garage.telephone}}",
    },
    {
      key: "vt_jp7",
      name: "Visite technique — J+7",
      channel: "EMAIL",
      type: "INSPECTION",
      subject: "Visite technique expirée : on vous aide à régulariser",
      body: "Bonjour {{client.salutation}},\nD'après notre suivi, la visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a expiré le {{vt.dateExpiration}}.\nSi elle a déjà été faite, répondez à cet email avec la nouvelle date d'expiration : nous mettrons votre dossier à jour et vous ne recevrez plus ce rappel.\nSinon, nous pouvons préparer votre véhicule rapidement. Appelez le {{garage.telephone}}.\n{{garage.nom}}",
    },
    // vt_multi (RG-M10-05/13) : un seul message groupé quand ≥ 2 véhicules du même client
    // atteignent le même palier le même jour.
    {
      key: "vt_multi",
      name: "Visite technique — plusieurs véhicules",
      channel: "WHATSAPP",
      type: "INSPECTION",
      body: "Bonjour {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos véhicules arrive à échéance :\n{{vehicules.liste}}\n{{garage.nom}} peut organiser les pré-visites en une seule fois. Répondez à ce message ou appelez le {{garage.telephone}}.",
    },
    {
      key: "vt_multi",
      name: "Visite technique — plusieurs véhicules",
      channel: "SMS",
      type: "INSPECTION",
      body: "{{garage.nom}}: {{client.salutation}}, la visite technique de {{vehicules.nombre}} de vos vehicules arrive a echeance. Detail et RDV: {{garage.telephone}}",
    },
    {
      key: "vt_multi",
      name: "Visite technique — plusieurs véhicules",
      channel: "EMAIL",
      type: "INSPECTION",
      subject: "Visites techniques à prévoir : {{vehicules.nombre}} véhicules",
      body: "Bonjour {{client.salutation}},\nLes visites techniques suivantes arrivent à échéance :\n{{vehicules.liste}}\nNous pouvons regrouper les pré-visites sur une même journée pour limiter l'immobilisation de votre flotte. Contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
    },
    // A.2 Révision
    {
      key: "rev_jm15",
      name: "Révision — J-15",
      channel: "WHATSAPP",
      type: "SERVICE",
      body: "Bonjour {{client.salutation}}, d'après notre suivi, la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) est à prévoir vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (estimation actuelle : {{vehicule.kmEstime}} km). Souhaitez-vous réserver un créneau ? {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "rev_jm15",
      name: "Révision — J-15",
      channel: "SMS",
      type: "SERVICE",
      body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} est a prevoir vers le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
    },
    {
      key: "rev_jm15",
      name: "Révision — J-15",
      channel: "EMAIL",
      type: "SERVICE",
      subject: "Votre {{vehicule.marque}} {{vehicule.modele}} approche de sa révision",
      body: "Bonjour {{client.salutation}},\nD'après notre suivi, votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) approche de sa révision : échéance vers le {{revision.dateEcheance}} ou à {{revision.kmEcheance}} km (nous estimons votre compteur à {{vehicule.kmEstime}} km).\nUne révision régulière (vidange, filtres, contrôle des freins et des niveaux) évite les pannes coûteuses et préserve la valeur de votre véhicule.\nPrenez rendez-vous au {{garage.telephone}} ou en ligne : {{lien.rdv}}\n{{garage.nom}}",
    },
    {
      key: "rev_j0",
      name: "Révision — J0",
      channel: "WHATSAPP",
      type: "SERVICE",
      body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est arrivé à l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine, comptez environ une demi-journée. Quel jour vous convient ? {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "rev_j0",
      name: "Révision — J0",
      channel: "SMS",
      type: "SERVICE",
      body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est due pour sa revision. Reservez au {{garage.telephone}}",
    },
    {
      key: "rev_j0",
      name: "Révision — J0",
      channel: "EMAIL",
      type: "SERVICE",
      subject: "C'est le moment de la révision de votre {{vehicule.marque}}",
      body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) a atteint l'échéance de sa révision. Nous pouvons vous recevoir dès cette semaine.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
    },
    {
      key: "rev_jp15",
      name: "Révision — J+15",
      channel: "WHATSAPP",
      type: "SERVICE",
      body: "Bonjour {{client.salutation}}, la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Rouler avec une huile usée use le moteur plus vite. Si elle a été faite ailleurs, dites-le-nous et nous mettrons votre suivi à jour. {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "rev_jp15",
      name: "Révision — J+15",
      channel: "SMS",
      type: "SERVICE",
      body: "{{garage.nom}}: {{client.salutation}}, la revision de votre {{vehicule.marque}} {{vehicule.plaque}} etait prevue le {{revision.dateEcheance}}. RDV: {{garage.telephone}}",
    },
    {
      key: "rev_jp15",
      name: "Révision — J+15",
      channel: "EMAIL",
      type: "SERVICE",
      subject: "Révision en retard sur votre {{vehicule.marque}}",
      body: "Bonjour {{client.salutation}},\nLa révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) était prévue le {{revision.dateEcheance}}. Si elle a été faite, répondez-nous avec la date et le kilométrage pour que nous mettions votre suivi à jour.\nSinon, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
    },
    {
      key: "rev_jp45",
      name: "Révision — J+45 (dernier rappel, validation)",
      channel: "WHATSAPP",
      type: "SERVICE",
      body: "Bonjour {{client.salutation}}, dernier petit rappel de {{garage.nom}} : la révision de votre {{vehicule.marque}} ({{vehicule.plaque}}) reste à faire. Nous restons à votre disposition au {{garage.telephone}}. Bonne route !",
    },
    {
      key: "rev_jp45",
      name: "Révision — J+45 (dernier rappel, validation)",
      channel: "SMS",
      type: "SERVICE",
      body: "{{garage.nom}}: {{client.salutation}}, dernier rappel pour la revision de votre {{vehicule.marque}} {{vehicule.plaque}}. RDV au {{garage.telephone}}",
    },
    {
      key: "rev_jp45",
      name: "Révision — J+45 (dernier rappel, validation)",
      channel: "EMAIL",
      type: "SERVICE",
      subject: "Dernier rappel : révision de votre {{vehicule.marque}}",
      body: "Bonjour {{client.salutation}},\nDernier rappel : la révision de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) reste à faire. Nous ne vous relancerons plus pour cette échéance.\n{{garage.nom}} — {{garage.telephone}}",
    },
    // rev_multi (RG-M10-05/13), même principe que vt_multi.
    {
      key: "rev_multi",
      name: "Révision — plusieurs véhicules",
      channel: "WHATSAPP",
      type: "SERVICE",
      body: "Bonjour {{client.salutation}}, {{vehicules.nombre}} de vos véhicules arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nNous pouvons les planifier sur une même journée. Répondez à ce message ou appelez le {{garage.telephone}}. {{garage.nom}}",
    },
    {
      key: "rev_multi",
      name: "Révision — plusieurs véhicules",
      channel: "SMS",
      type: "SERVICE",
      body: "{{garage.nom}}: {{client.salutation}}, {{vehicules.nombre}} de vos vehicules sont dus pour leur revision. Planning: {{garage.telephone}}",
    },
    {
      key: "rev_multi",
      name: "Révision — plusieurs véhicules",
      channel: "EMAIL",
      type: "SERVICE",
      subject: "Révisions à planifier : {{vehicules.nombre}} véhicules",
      body: "Bonjour {{client.salutation}},\nLes véhicules suivants arrivent à l'échéance de leur révision :\n{{vehicules.liste}}\nContactez-nous au {{garage.telephone}} pour les planifier ensemble.\n{{garage.nom}}",
    },
    // vt_rev_combo (RG-M10-13) : VT et révision dues en même temps sur le même véhicule.
    {
      key: "vt_rev_combo",
      name: "Visite technique + révision (même véhicule)",
      channel: "WHATSAPP",
      body: "Bonjour {{client.salutation}}, deux échéances pour votre {{vehicule.marque}} ({{vehicule.plaque}}) : la visite technique expire le {{vt.dateExpiration}} et la révision est due. Faites les deux en un seul passage chez {{garage.nom}}. Réservez au {{garage.telephone}}.",
    },
    {
      key: "vt_rev_combo",
      name: "Visite technique + révision (même véhicule)",
      channel: "SMS",
      body: "{{garage.nom}}: {{client.salutation}}, visite technique (exp. {{vt.dateExpiration}}) et revision a faire sur votre {{vehicule.plaque}}. RDV: {{garage.telephone}}",
    },
    {
      key: "vt_rev_combo",
      name: "Visite technique + révision (même véhicule)",
      channel: "EMAIL",
      subject: "Visite technique et révision : un seul passage",
      body: "Bonjour {{client.salutation}},\nLa visite technique de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) expire le {{vt.dateExpiration}} et sa révision est due. Nous pouvons faire la révision et la pré-visite en un seul passage.\nRéservez au {{garage.telephone}} ou ici : {{lien.rdv}}\n{{garage.nom}}",
    },
    // A.3 Créances
    {
      key: "cr_jp3",
      name: "Créances — J+3 (courtois)",
      channel: "WHATSAPP",
      type: "RECEIVABLE",
      body: "Bonjour {{client.salutation}}, sauf erreur de notre part, {{factures.resume}} reste à régler. Vous pouvez payer en un clic par Wave ou Orange Money : {{lien.paiement}}. Si le paiement est déjà fait, merci de nous le signaler et ignorez ce message. Bonne journée ! {{garage.nom}}",
    },
    {
      key: "cr_jp3",
      name: "Créances — J+3 (courtois)",
      channel: "SMS",
      type: "RECEIVABLE",
      body: "{{garage.nom}}: bonjour {{client.salutation}}, rappel de paiement pour {{factures.resume}}. Payer: {{lien.paiement}} Merci",
    },
    {
      key: "cr_jp3",
      name: "Créances — J+3 (courtois)",
      channel: "EMAIL",
      type: "RECEIVABLE",
      subject: "Rappel : {{factures.resume}}",
      body: "Bonjour {{client.salutation}},\nSauf erreur de notre part, le règlement suivant n'a pas encore été enregistré :\n{{factures.detail}}\nVous pouvez payer en ligne (Wave, Orange Money, MTN MoMo, carte) : {{lien.paiement}} — ou à notre caisse.\nSi vous avez déjà réglé, merci d'ignorer ce message.\n{{garage.nom}} — {{garage.telephone}}",
    },
    {
      key: "cr_jp15",
      name: "Créances — J+15 (rappel)",
      channel: "WHATSAPP",
      type: "RECEIVABLE",
      body: "Bonjour {{client.salutation}}, nous n'avons toujours pas reçu le règlement de {{factures.resume}}. Pouvez-vous nous indiquer quand vous pensez payer ? Lien de paiement : {{lien.paiement}}. Merci. {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "cr_jp15",
      name: "Créances — J+15 (rappel)",
      channel: "SMS",
      type: "RECEIVABLE",
      body: "{{garage.nom}}: {{client.salutation}}, nous attendons toujours le reglement de {{factures.resume}}. Payer: {{lien.paiement}}",
    },
    {
      key: "cr_jp15",
      name: "Créances — J+15 (rappel)",
      channel: "EMAIL",
      type: "RECEIVABLE",
      subject: "Deuxième rappel : règlement en attente",
      body: "Bonjour {{client.salutation}},\nMalgré notre précédent rappel, le règlement suivant reste en attente :\n{{factures.detail}}\nPouvez-vous nous indiquer la date à laquelle vous prévoyez de régler ? Paiement en ligne : {{lien.paiement}}\n{{garage.nom}} — {{garage.telephone}}",
    },
    {
      key: "cr_jp30",
      name: "Créances — J+30 (ferme, validation)",
      channel: "WHATSAPP",
      type: "RECEIVABLE",
      body: "{{client.salutation}}, malgré nos rappels, {{factures.resume}} n'est toujours pas réglé ({{client.joursRetardMax}} jours de retard). Nous vous demandons de régulariser sous 7 jours ou de nous appeler au {{garage.telephone}} pour convenir d'un échéancier. Paiement : {{lien.paiement}}. {{garage.nom}}",
    },
    {
      key: "cr_jp30",
      name: "Créances — J+30 (ferme, validation)",
      channel: "SMS",
      type: "RECEIVABLE",
      body: "{{garage.nom}}: {{client.salutation}}, {{factures.resume}}: {{client.joursRetardMax}} j de retard. Merci de regulariser sous 7 jours: {{lien.paiement}}",
    },
    {
      key: "cr_jp30",
      name: "Créances — J+30 (ferme, validation)",
      channel: "EMAIL",
      type: "RECEIVABLE",
      subject: "Relance : régularisation demandée sous 7 jours",
      body: "{{client.salutation}},\nMalgré nos rappels, le règlement suivant n'a pas été effectué :\n{{factures.detail}}\nRetard : {{client.joursRetardMax}} jours. Nous vous demandons de régulariser cette situation sous 7 jours. Si vous rencontrez une difficulté, appelez-nous au {{garage.telephone}} : nous pouvons convenir d'un échéancier.\nPaiement en ligne : {{lien.paiement}}\n{{garage.nom}}",
    },
    {
      key: "cr_mise_en_demeure",
      name: "Créances — J+60 (mise en demeure, validation OWNER)",
      channel: "WHATSAPP",
      type: "RECEIVABLE",
      body: "{{client.salutation}}, vous trouverez ci-joint une mise en demeure de {{garage.nom}} concernant {{factures.resume}}. Pour régler ou en discuter, contactez-nous au {{garage.telephone}}.",
    },
    {
      key: "cr_mise_en_demeure",
      name: "Créances — J+60 (mise en demeure, validation OWNER)",
      channel: "SMS",
      type: "RECEIVABLE",
      body: "{{garage.nom}}: {{client.salutation}}, une mise en demeure concernant {{factures.resume}} vous a ete adressee. Contact: {{garage.telephone}}",
    },
    {
      key: "cr_mise_en_demeure",
      name: "Créances — J+60 (mise en demeure, validation OWNER)",
      channel: "EMAIL",
      type: "RECEIVABLE",
      subject: "Mise en demeure de payer — {{client.nomComplet}}",
      body: "{{client.salutation}},\nVeuillez trouver ci-joint une mise en demeure de payer la somme de {{client.soldeEnRetard}} au titre des factures listées dans le document.\nPour toute question ou pour convenir d'un règlement, contactez-nous au {{garage.telephone}}.\n{{garage.nom}}",
    },
    // cr_alerte_gerant (J+45, internalOnly ⇒ channels:[]) n'a pas de variante par canal : c'est
    // une notification interne / ligne du résumé quotidien (RG-M10-02), jamais un message client.
    // Pas de ligne MessageTemplate pour cette clé : le modèle n'a pas de champ Channel pertinent.

    // Variante entreprises, step unique de la règle "Échéance proche (entreprises)" (inactive
    // par défaut). Annexe A donne aussi une variante SMS ; on la transcrit même si le palier
    // par défaut n'utilise que EMAIL + WHATSAPP (RG-M10-02), pour que le modèle soit disponible
    // si un MANAGER active le canal SMS sur cette règle.
    {
      key: "cr_avant_echeance_pro",
      name: "Créances — J-3 avant échéance (entreprises)",
      channel: "WHATSAPP",
      type: "RECEIVABLE",
      body: "Bonjour {{client.salutation}}, pour information, la facture {{facture.numero}} de {{facture.solde}} arrive à échéance le {{facture.echeance}}. Facture : {{lien.facture}} – Paiement : {{lien.paiement}}. {{garage.nom}}",
    },
    {
      key: "cr_avant_echeance_pro",
      name: "Créances — J-3 avant échéance (entreprises)",
      channel: "SMS",
      type: "RECEIVABLE",
      body: "{{garage.nom}}: facture {{facture.numero}} ({{facture.solde}}) a regler avant le {{facture.echeance}}. Paiement: {{lien.paiement}}",
    },
    {
      key: "cr_avant_echeance_pro",
      name: "Créances — J-3 avant échéance (entreprises)",
      channel: "EMAIL",
      type: "RECEIVABLE",
      subject: "Échéance le {{facture.echeance}} — facture {{facture.numero}}",
      body: "Madame, Monsieur,\nPour faciliter votre planification, la facture {{facture.numero}} d'un montant de {{facture.solde}} arrive à échéance le {{facture.echeance}}.\nFacture : {{lien.facture}} — Paiement : {{lien.paiement}}\nService facturation — {{garage.nom}}",
    },
    // A.4 Rendez-vous
    {
      key: "rdv_confirm",
      name: "Rendez-vous — confirmation",
      channel: "WHATSAPP",
      type: "APPOINTMENT",
      body: "Bonjour {{client.salutation}}, votre rendez-vous chez {{garage.nom}} est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} ({{vehicule.plaque}}). Adresse : {{garage.adresse}}. Un empêchement ? Répondez à ce message ou appelez le {{garage.telephone}}.",
    },
    {
      key: "rdv_confirm",
      name: "Rendez-vous — confirmation",
      channel: "SMS",
      type: "APPOINTMENT",
      body: "{{garage.nom}}: RDV confirme le {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Changement? Tel {{garage.telephone}}",
    },
    {
      key: "rdv_confirm",
      name: "Rendez-vous — confirmation",
      channel: "EMAIL",
      type: "APPOINTMENT",
      subject: "Rendez-vous confirmé le {{rdv.date}} à {{rdv.heure}}",
      body: "Bonjour {{client.salutation}},\nVotre rendez-vous est confirmé le {{rdv.date}} à {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}).\nAdresse : {{garage.adresse}}. Pensez à apporter la carte grise et, si possible, votre carnet d'entretien.\nPour déplacer le rendez-vous : {{garage.telephone}}. {{garage.nom}}",
    },
    {
      key: "rdv_jm1",
      name: "Rendez-vous — J-1 (veille, 17h)",
      channel: "WHATSAPP",
      type: "APPOINTMENT",
      body: "Bonjour {{client.salutation}}, petit rappel : nous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Répondez OUI pour confirmer ou appelez le {{garage.telephone}} pour décaler. {{garage.nom}}",
    },
    {
      key: "rdv_jm1",
      name: "Rendez-vous — J-1 (veille, 17h)",
      channel: "SMS",
      type: "APPOINTMENT",
      body: "{{garage.nom}}: rappel, RDV demain {{rdv.date}} a {{rdv.heure}} pour votre {{vehicule.marque}} {{vehicule.plaque}}. Tel {{garage.telephone}}",
    },
    {
      key: "rdv_jm1",
      name: "Rendez-vous — J-1 (veille, 17h)",
      channel: "EMAIL",
      type: "APPOINTMENT",
      subject: "Rappel : rendez-vous demain à {{rdv.heure}}",
      body: "Bonjour {{client.salutation}},\nNous vous attendons demain {{rdv.date}} à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). Pour décaler : {{garage.telephone}}.\n{{garage.nom}} — {{garage.adresse}}",
    },
    // rdv_hm2 : pas de variante Email d'après le PRD ("non utilisé, trop tardif").
    {
      key: "rdv_hm2",
      name: "Rendez-vous — H-2 (inactif par défaut)",
      channel: "WHATSAPP",
      type: "APPOINTMENT",
      body: "Bonjour {{client.salutation}}, nous vous attendons aujourd'hui à {{rdv.heure}} avec votre {{vehicule.marque}} ({{vehicule.plaque}}). À tout à l'heure ! {{garage.nom}}",
    },
    {
      key: "rdv_hm2",
      name: "Rendez-vous — H-2 (inactif par défaut)",
      channel: "SMS",
      type: "APPOINTMENT",
      body: "{{garage.nom}}: nous vous attendons aujourd'hui a {{rdv.heure}} avec votre {{vehicule.plaque}}. Tel {{garage.telephone}}",
    },
    // A.5 Suivi de devis
    {
      key: "devis_jp2",
      name: "Suivi de devis — J+2",
      channel: "WHATSAPP",
      type: "QUOTE_FOLLOWUP",
      body: "Bonjour {{client.salutation}}, avez-vous pu consulter le devis {{devis.numero}} ({{devis.montant}}) pour votre {{vehicule.marque}} ? Vous pouvez l'accepter en ligne, ligne par ligne : {{lien.devis}}. Une question ? Répondez ici. {{garage.nom}}",
    },
    {
      key: "devis_jp2",
      name: "Suivi de devis — J+2",
      channel: "SMS",
      type: "QUOTE_FOLLOWUP",
      body: "{{garage.nom}}: {{client.salutation}}, votre devis {{devis.numero}} ({{devis.montant}}) vous attend: {{lien.devis}} Tel {{garage.telephone}}",
    },
    {
      key: "devis_jp2",
      name: "Suivi de devis — J+2",
      channel: "EMAIL",
      type: "QUOTE_FOLLOWUP",
      subject: "Votre devis {{devis.numero}} vous attend",
      body: "Bonjour {{client.salutation}},\nVotre devis {{devis.numero}} d'un montant de {{devis.montant}} pour votre {{vehicule.marque}} {{vehicule.modele}} est disponible ici : {{lien.devis}}\nVous pouvez accepter tout ou partie des travaux en ligne. Pour toute question : {{garage.telephone}}.\n{{garage.nom}}",
    },
    {
      key: "devis_jp5",
      name: "Suivi de devis — J+5",
      channel: "WHATSAPP",
      type: "QUOTE_FOLLOWUP",
      body: "Bonjour {{client.salutation}}, souhaitez-vous que nous lancions les travaux du devis {{devis.numero}} ? Les points urgents concernent votre sécurité. Accepter en ligne : {{lien.devis}} ou appelez le {{garage.telephone}}. {{garage.nom}}",
    },
    {
      key: "devis_jp5",
      name: "Suivi de devis — J+5",
      channel: "SMS",
      type: "QUOTE_FOLLOWUP",
      body: "{{garage.nom}}: {{client.salutation}}, on lance les travaux du devis {{devis.numero}}? Accepter en ligne: {{lien.devis}}",
    },
    {
      key: "devis_jp5",
      name: "Suivi de devis — J+5",
      channel: "EMAIL",
      type: "QUOTE_FOLLOWUP",
      subject: "Devis {{devis.numero}} : souhaitez-vous lancer les travaux ?",
      body: "Bonjour {{client.salutation}},\nNous restons dans l'attente de votre décision sur le devis {{devis.numero}} ({{devis.montant}}). Les points marqués « urgent » concernent votre sécurité.\nDécider en ligne : {{lien.devis}} — ou appelez-nous au {{garage.telephone}}.\n{{garage.nom}}",
    },
    {
      key: "devis_expire",
      name: "Suivi de devis — expiration (validation)",
      channel: "WHATSAPP",
      type: "QUOTE_FOLLOWUP",
      body: "Bonjour {{client.salutation}}, le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Après cette date, les prix des pièces pourront changer. Pour le valider : {{lien.devis}}. {{garage.nom}}",
    },
    {
      key: "devis_expire",
      name: "Suivi de devis — expiration (validation)",
      channel: "SMS",
      type: "QUOTE_FOLLOWUP",
      body: "{{garage.nom}}: le devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Pour le valider: {{lien.devis}}",
    },
    {
      key: "devis_expire",
      name: "Suivi de devis — expiration (validation)",
      channel: "EMAIL",
      type: "QUOTE_FOLLOWUP",
      subject: "Votre devis {{devis.numero}} expire le {{devis.validite}}",
      body: "Bonjour {{client.salutation}},\nLe devis {{devis.numero}} est valable jusqu'au {{devis.validite}}. Au-delà, nous devrons actualiser les prix des pièces.\nValider en ligne : {{lien.devis}}\n{{garage.nom}}",
    },
    // A.6 Véhicule prêt
    {
      key: "pret_j0",
      name: "Véhicule prêt — J0",
      channel: "WHATSAPP",
      type: "VEHICLE_READY",
      body: "Bonjour {{client.salutation}}, bonne nouvelle : votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt ! Montant à régler : {{facture.solde}}. Payez avant de venir pour gagner du temps : {{lien.paiement}}. Nous sommes ouverts {{garage.horaires}}. {{garage.nom}}",
    },
    {
      key: "pret_j0",
      name: "Véhicule prêt — J0",
      channel: "SMS",
      type: "VEHICLE_READY",
      body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} est disponible. A regler: {{facture.solde}}. Payer: {{lien.paiement}}",
    },
    {
      key: "pret_j0",
      name: "Véhicule prêt — J0",
      channel: "EMAIL",
      type: "VEHICLE_READY",
      subject: "Votre {{vehicule.marque}} est prêt",
      body: "Bonjour {{client.salutation}},\nLes travaux sur votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) sont terminés. Montant à régler : {{facture.solde}}.\nFacture : {{lien.facture}} — Paiement en ligne : {{lien.paiement}}\nNous vous attendons {{garage.horaires}}. {{garage.nom}} — {{garage.adresse}}",
    },
    {
      key: "pret_jp2",
      name: "Véhicule prêt — J+2",
      channel: "WHATSAPP",
      type: "VEHICLE_READY",
      body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) vous attend chez {{garage.nom}} depuis 2 jours. Quand pensez-vous passer le récupérer ? {{garage.telephone}}",
    },
    {
      key: "pret_jp2",
      name: "Véhicule prêt — J+2",
      channel: "SMS",
      type: "VEHICLE_READY",
      body: "{{garage.nom}}: {{client.salutation}}, votre {{vehicule.marque}} {{vehicule.plaque}} vous attend depuis 2 jours. Tel {{garage.telephone}}",
    },
    {
      key: "pret_jp2",
      name: "Véhicule prêt — J+2",
      channel: "EMAIL",
      type: "VEHICLE_READY",
      subject: "Votre véhicule vous attend",
      body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 2 jours. Quand pensez-vous passer ? {{garage.telephone}}\n{{garage.nom}}",
    },
    {
      key: "pret_jp5",
      name: "Véhicule prêt — J+5 (validation)",
      channel: "WHATSAPP",
      type: "VEHICLE_READY",
      body: "Bonjour {{client.salutation}}, votre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement : au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer selon nos conditions. {{garage.nom}} – {{garage.telephone}}",
    },
    {
      key: "pret_jp5",
      name: "Véhicule prêt — J+5 (validation)",
      channel: "SMS",
      type: "VEHICLE_READY",
      body: "{{garage.nom}}: votre {{vehicule.plaque}} est disponible depuis 5 jours. Frais de gardiennage possibles apres 7 jours. Tel {{garage.telephone}}",
    },
    {
      key: "pret_jp5",
      name: "Véhicule prêt — J+5 (validation)",
      channel: "EMAIL",
      type: "VEHICLE_READY",
      subject: "Votre véhicule est prêt depuis 5 jours",
      body: "Bonjour {{client.salutation}},\nVotre {{vehicule.marque}} ({{vehicule.plaque}}) est prêt depuis 5 jours. Merci de passer le récupérer rapidement ; au-delà de 7 jours, des frais de gardiennage peuvent s'appliquer conformément à nos conditions générales.\n{{garage.nom}} — {{garage.telephone}}",
    },
    // A.7 Assurance
    {
      key: "assur_jm15",
      name: "Assurance — J-15 (inactif par défaut)",
      channel: "WHATSAPP",
      type: "INSURANCE_EXPIRY",
      body: "Bonjour {{client.salutation}}, l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler pour rouler l'esprit tranquille. {{garage.nom}}",
    },
    {
      key: "assur_jm15",
      name: "Assurance — J-15 (inactif par défaut)",
      channel: "SMS",
      type: "INSURANCE_EXPIRY",
      body: "{{garage.nom}}: {{client.salutation}}, l'assurance de votre {{vehicule.marque}} {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler.",
    },
    {
      key: "assur_jm15",
      name: "Assurance — J-15 (inactif par défaut)",
      channel: "EMAIL",
      type: "INSURANCE_EXPIRY",
      subject: "Votre assurance auto expire le {{assurance.dateExpiration}}",
      body: "Bonjour {{client.salutation}},\nD'après nos informations, l'assurance de votre {{vehicule.marque}} {{vehicule.modele}} ({{vehicule.plaque}}) arrive à échéance le {{assurance.dateExpiration}}. Pensez à la renouveler auprès de votre assureur.\n{{garage.nom}}",
    },
    {
      key: "assur_jm3",
      name: "Assurance — J-3 (inactif par défaut)",
      channel: "WHATSAPP",
      type: "INSURANCE_EXPIRY",
      body: "Bonjour {{client.salutation}}, rappel : l'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si c'est déjà renouvelé, envoyez-nous la nouvelle date et nous mettrons votre dossier à jour. {{garage.nom}}",
    },
    {
      key: "assur_jm3",
      name: "Assurance — J-3 (inactif par défaut)",
      channel: "SMS",
      type: "INSURANCE_EXPIRY",
      body: "{{garage.nom}}: rappel, l'assurance de votre {{vehicule.plaque}} expire le {{assurance.dateExpiration}}. Pensez a la renouveler avant de rouler.",
    },
    {
      key: "assur_jm3",
      name: "Assurance — J-3 (inactif par défaut)",
      channel: "EMAIL",
      type: "INSURANCE_EXPIRY",
      subject: "Rappel : assurance à renouveler avant le {{assurance.dateExpiration}}",
      body: "Bonjour {{client.salutation}},\nL'assurance de votre {{vehicule.marque}} ({{vehicule.plaque}}) expire le {{assurance.dateExpiration}}. Si elle est déjà renouvelée, répondez-nous avec la nouvelle date d'échéance.\n{{garage.nom}}",
    },
    // A.8 Satisfaction
    {
      key: "satis_jp2",
      name: "Satisfaction — J+2",
      channel: "WHATSAPP",
      type: "SATISFACTION",
      body: "Bonjour {{client.salutation}}, merci d'avoir confié votre {{vehicule.marque}} à {{garage.nom}}. Comment s'est passée votre visite ? Notez-nous de 1 à 5 en répondant à ce message, ou donnez votre avis ici : {{lien.avis}}. Votre retour nous aide à progresser.",
    },
    {
      key: "satis_jp2",
      name: "Satisfaction — J+2",
      channel: "SMS",
      type: "SATISFACTION",
      body: "{{garage.nom}}: merci pour votre visite! Donnez votre avis en 1 clic: {{lien.avis}}",
    },
    {
      key: "satis_jp2",
      name: "Satisfaction — J+2",
      channel: "EMAIL",
      type: "SATISFACTION",
      subject: "Comment s'est passée votre visite chez {{garage.nom}} ?",
      body: "Bonjour {{client.salutation}},\nMerci d'avoir confié votre {{vehicule.marque}} {{vehicule.modele}} à notre atelier. Votre avis compte : il ne prend que 30 secondes.\n{{lien.avis}}\n{{garage.nom}}",
    },
  ];
  await adminDb.messageTemplate.createMany({
    data: messageTemplates.map((t) => ({
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
  // Les 9 règles livrées par défaut (docs/modules/M10-relances-automatiques.md, RG-M10-02),
  // conformes au schéma Zod de packages/validators/src/reminders.ts (RG-M10-03) : offsets
  // strictement croissants dans l'ordre du tableau `steps`, `internalOnly ⇒ channels: []`.
  function sendWindow(days: number[], from: string, to: string, preferredTime: string) {
    return { days, from, to, preferredTime };
  }
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "INSPECTION",
      name: "Visite technique",
      isActive: true,
      steps: [
        {
          key: "J-30",
          label: "1er rappel",
          offsetDays: -30,
          templateKey: "vt_j30",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J-7",
          label: "Rappel urgent",
          offsetDays: -7,
          templateKey: "vt_j7",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J0",
          label: "Jour J",
          offsetDays: 0,
          templateKey: "vt_j0",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+7",
          label: "Relance retard",
          offsetDays: 7,
          templateKey: "vt_jp7",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
      conditions: {},
      stopOn: ["appointment.created", "vehicle.inspection_updated", "repair_order.created"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "SERVICE",
      name: "Révision",
      isActive: true,
      steps: [
        {
          key: "J-15",
          label: "1er rappel",
          offsetDays: -15,
          templateKey: "rev_jm15",
          autoSend: true,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          key: "J0",
          label: "Échéance atteinte",
          offsetDays: 0,
          templateKey: "rev_j0",
          autoSend: true,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          key: "J+15",
          label: "Rappel retard",
          offsetDays: 15,
          templateKey: "rev_jp15",
          autoSend: true,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          key: "J+45",
          label: "Dernier rappel (validation)",
          offsetDays: 45,
          templateKey: "rev_jp45",
          autoSend: false,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
      ],
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:30"),
      conditions: {},
      stopOn: ["appointment.created", "repair_order.created", "vehicle.service_recorded"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "RECEIVABLE",
      name: "Créances",
      isActive: true,
      steps: [
        {
          key: "J+3",
          label: "Rappel courtois",
          offsetDays: 3,
          templateKey: "cr_jp3",
          autoSend: true,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          key: "J+15",
          label: "Rappel",
          offsetDays: 15,
          templateKey: "cr_jp15",
          autoSend: true,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          key: "J+30",
          label: "Relance ferme (validation)",
          offsetDays: 30,
          templateKey: "cr_jp30",
          autoSend: false,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
        },
        {
          // RG-M10-03 : internalOnly ⇒ channels obligatoirement vide (pas de message client,
          // juste une alerte interne / ligne du résumé quotidien, RG-M10-02).
          key: "J+45",
          label: "Alerte gérant (interne)",
          offsetDays: 45,
          templateKey: "cr_alerte_gerant",
          autoSend: true,
          channels: [],
          internalOnly: true,
        },
        {
          key: "J+60",
          label: "Mise en demeure (validation OWNER)",
          offsetDays: 60,
          templateKey: "cr_mise_en_demeure",
          autoSend: false,
          channels: ["WHATSAPP", "SMS", "EMAIL"],
          requiresPermission: "receivable:formal_notice",
          attachments: ["formal_notice"],
        },
      ],
      sendWindow: sendWindow([1, 2, 3, 4, 5], "08:30", "18:00", "10:00"),
      conditions: {},
      stopOn: [
        "payment.received",
        "collection.promised",
        "collection.disputed",
        "collection.paused",
      ],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "RECEIVABLE",
      name: "Échéance proche (entreprises)",
      isActive: false, // RG-M10-02 : inactive par défaut
      steps: [
        {
          key: "J-3",
          label: "Rappel avant échéance",
          offsetDays: -3,
          templateKey: "cr_avant_echeance_pro",
          autoSend: true,
          channels: ["EMAIL", "WHATSAPP"],
        },
      ],
      // Fenêtre lun-ven, préférée 10:00 (RG-M10-02) ; from/to non précisés par le PRD pour
      // cette règle : on reprend ceux de la règle "Créances" (même plage ouvrière), choix
      // raisonnable documenté ici.
      sendWindow: sendWindow([1, 2, 3, 4, 5], "08:30", "18:00", "10:00"),
      conditions: { customerTypes: ["COMPANY"] },
      stopOn: ["payment.received"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "APPOINTMENT",
      name: "Rendez-vous",
      isActive: true,
      steps: [
        {
          // RG-M10-02 : "CONFIRM (à la création)" est déclenché immédiatement à la création du
          // RDV, pas par le décalage générique du planificateur. offsetDays:-2 n'est qu'un
          // repère pour respecter la contrainte Zod des offsets strictement croissants
          // (RG-M10-03) avant J-1 (-1) et H-2 (0) : la vraie règle de déclenchement de CONFIRM
          // est gérée par le worker (événement appointment.created), pas par cet offset.
          key: "CONFIRM",
          label: "Confirmation",
          offsetDays: -2,
          templateKey: "rdv_confirm",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J-1",
          label: "Rappel veille (17h)",
          offsetDays: -1,
          sendAt: "17:00",
          templateKey: "rdv_jm1",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          // RG-M10-02 : le palier H-2 est "inactif par défaut" dans le tableau du PRD, mais
          // c'est une note par palier, pas par règle, et ReminderStep (RG-M10-03) n'a pas de
          // champ isActive par palier. On garde donc le palier dans la frise (pour qu'un
          // MANAGER puisse l'activer plus tard) mais avec autoSend:false, qui force la
          // validation et approxime l'intention "inactif par défaut" sans bloc technique.
          key: "H-2",
          label: "Rappel 2h avant (inactif par défaut)",
          offsetDays: 0,
          offsetHours: -2,
          templateKey: "rdv_hm2",
          autoSend: false,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      // preferredTime non précisé par le PRD pour cette règle (fenêtre lun-sam 07:00-20:00) :
      // 08:00 est un choix raisonnable, documenté ici.
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "07:00", "20:00", "08:00"),
      conditions: {},
      stopOn: ["appointment.cancelled", "appointment.updated"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "QUOTE_FOLLOWUP",
      name: "Suivi de devis",
      isActive: true,
      // RG-M10-03 : les offsetDays doivent être strictement croissants dans l'ordre du
      // tableau, quelle que soit l'ancre. EXPIRE (ancre validUntil, offsetDays:-1) doit donc
      // apparaître avant J+2/J+5 (ancre sentAt, offsetDays 2 et 5) même si, dans le tableau
      // RG-M10-02, il est listé en dernier : les deux ancres suivent des horloges
      // indépendantes (date d'envoi du devis vs. date de validité), l'ordre du tableau Prisma
      // ne reflète donc pas l'ordre chronologique réel pour un devis donné.
      steps: [
        {
          key: "EXPIRE",
          label: "Expiration (validation)",
          offsetDays: -1,
          anchor: "validUntil",
          templateKey: "devis_expire",
          autoSend: false,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+2",
          label: "Relance 1",
          offsetDays: 2,
          anchor: "sentAt",
          templateKey: "devis_jp2",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+5",
          label: "Relance 2",
          offsetDays: 5,
          anchor: "sentAt",
          templateKey: "devis_jp5",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
      conditions: {},
      stopOn: ["quote.accepted", "quote.declined", "quote.expired"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "VEHICLE_READY",
      name: "Véhicule prêt",
      isActive: true,
      steps: [
        {
          key: "J0",
          label: "Véhicule prêt",
          offsetDays: 0,
          templateKey: "pret_j0",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+2",
          label: "Rappel 2 jours",
          offsetDays: 2,
          templateKey: "pret_jp2",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J+5",
          label: "Rappel 5 jours (validation)",
          offsetDays: 5,
          templateKey: "pret_jp5",
          autoSend: false,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      // preferredTime non précisé par le PRD pour cette règle (fenêtre lun-sam 07:30-19:30) :
      // 08:00 est un choix raisonnable, documenté ici.
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "07:30", "19:30", "08:00"),
      conditions: {},
      stopOn: ["repair_order.status_changed"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "INSURANCE_EXPIRY",
      name: "Assurance",
      isActive: false, // RG-M10-02 : inactive par défaut
      steps: [
        {
          key: "J-15",
          label: "1er rappel",
          offsetDays: -15,
          templateKey: "assur_jm15",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
        {
          key: "J-3",
          label: "Rappel final",
          offsetDays: -3,
          templateKey: "assur_jm3",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      // from/to non précisés par le PRD pour cette règle (lun-sam, préférée 09:00) : on
      // reprend la plage 08:00-19:00 de la règle "Visite technique", choix raisonnable.
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "08:00", "19:00", "09:00"),
      conditions: {},
      stopOn: ["vehicle.insurance_updated"],
    },
  });
  await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "SATISFACTION",
      name: "Satisfaction",
      isActive: true,
      steps: [
        {
          // RG-M10-01 : l'ancre PRD est `deliveredAt` (RepairOrder), mais l'enum Zod `anchor`
          // (RG-M10-03) n'a que "default"/"sentAt"/"validUntil" — pas de valeur "deliveredAt".
          // On utilise donc "default" ; la résolution de l'ancre réelle (deliveredAt) se fait
          // côté worker pour le type SATISFACTION, pas dans ce champ de la règle.
          key: "J+2",
          label: "Enquête de satisfaction",
          offsetDays: 2,
          anchor: "default",
          templateKey: "satis_jp2",
          autoSend: true,
          channels: ["WHATSAPP", "SMS"],
        },
      ],
      sendWindow: sendWindow([1, 2, 3, 4, 5, 6], "10:00", "18:00", "10:00"),
      conditions: {},
      stopOn: [], // RG-M10-02 : "—" (aucun événement d'arrêt listé)
    },
  });

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
      `${messageTemplates.length} modèles de message et 9 règles de relance (M10) par défaut.`,
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
