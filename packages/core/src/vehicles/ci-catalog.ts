export interface CatalogModelDefinition {
  name: string;
  serviceIntervalKm?: number;
  serviceIntervalMonths?: number;
  defaultFuel?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC" | "LPG" | "OTHER";
}

export interface CatalogMakeDefinition {
  name: string;
  popular?: boolean;
  models: CatalogModelDefinition[];
}

/**
 * Catalogue très riche des marques et modèles de véhicules les plus fréquents en Côte d'Ivoire (Abidjan et intérieur).
 * Sert de base au seed de la base de données, aux suggestions automatiques de saisie et à la détection de modèles.
 */
export const CI_VEHICLE_CATALOG: CatalogMakeDefinition[] = [
  {
    name: "Toyota",
    popular: true,
    models: [
      { name: "Hilux", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Land Cruiser", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Land Cruiser Prado", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "RAV4", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Corolla", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Corolla Cross", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "HYBRID" },
      { name: "Yaris", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Yaris Cross", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "HYBRID" },
      { name: "Fortuner", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Hiace", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Rush", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Starlet", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Camry", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Avensis", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Urban Cruiser", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Coaster", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Dyna", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Peugeot",
    popular: true,
    models: [
      { name: "208", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "301", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "2008", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "3008", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "5008", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Landtrek", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Partner", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Expert", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Boxer", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "508", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "308", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "207", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "206", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "406", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "407", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Hyundai",
    popular: true,
    models: [
      { name: "Tucson", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Santa Fe", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Creta", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Accent", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Elantra", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "i10", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Grand i10", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "i20", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Kona", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Venue", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "H1 / Starex", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "HD65 / HD72", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Sonata", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Kia",
    popular: true,
    models: [
      { name: "Sportage", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sorento", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Picanto", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Rio", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Cerato", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Seltos", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Pegas", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sonet", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Carnival", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "K2700", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Nissan",
    popular: true,
    models: [
      { name: "Navara", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Patrol", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Hardbody", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Qashqai", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "X-Trail", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Kicks", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Almera", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sunny", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Urvan", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Pathfinder", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Juke", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Mitsubishi",
    popular: true,
    models: [
      { name: "L200", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Pajero", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Pajero Sport", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Outlander", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "ASX", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Eclipse Cross", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Canter", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Xpander", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Suzuki",
    popular: true,
    models: [
      { name: "Swift", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Grand Vitara", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Vitara", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Jimny", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Dzire", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Celerio", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Alto", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Ertiga", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Baleno", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "S-Presso", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Renault",
    popular: true,
    models: [
      { name: "Duster", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Logan", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sandero", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Kwid", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Clio", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Megane", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Captur", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Kangoo", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Master", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Trafic", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Express", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Koleos", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Mercedes-Benz",
    popular: true,
    models: [
      { name: "Classe C", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe E", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe S", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe A", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe GLA", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe GLC", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Classe GLE / ML", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Classe GLS / GL", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Classe G", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sprinter", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Vito", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Ford",
    popular: true,
    models: [
      { name: "Ranger", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Everest", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Explorer", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "EcoSport", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Escape", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Edge", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "F-150", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Focus", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Fiesta", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Transit", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Isuzu",
    popular: true,
    models: [
      { name: "D-Max", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "mu-X", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "NPR", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "NQR", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "FVR", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "BMW",
    popular: true,
    models: [
      { name: "Série 3", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Série 5", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Série 7", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Série 1", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "X1", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "X3", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "X5", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "X6", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Volkswagen",
    popular: false,
    models: [
      { name: "Golf", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Polo", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Tiguan", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Touareg", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Passat", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Amarok", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "T-Cross", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Caddy", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Transporter", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Honda",
    popular: false,
    models: [
      { name: "CR-V", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Civic", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Accord", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "HR-V", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Pilot", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "City", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Fit", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Changan",
    popular: true,
    models: [
      { name: "CS35 Plus", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "CS55 Plus", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "CS75 Plus", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "CS85 Coupe", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Alsvin", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Hunter", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Uni-T", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Uni-K", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Great Wall / Haval",
    popular: true,
    models: [
      { name: "Haval H6", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Haval Jolion", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Haval Dargo", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Wingle 5", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Wingle 7", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Poer", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Tank 300", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Mazda",
    popular: false,
    models: [
      { name: "BT-50", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "CX-5", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "CX-3", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "CX-30", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Mazda 3", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Mazda 6", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Land Rover",
    popular: false,
    models: [
      { name: "Range Rover", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Range Rover Sport", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Range Rover Evoque", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Range Rover Velar", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Defender", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Discovery", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Discovery Sport", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Lexus",
    popular: false,
    models: [
      { name: "LX 570 / LX 600", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "GX 460", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "RX 350", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "NX 200 / NX 300", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "ES 350", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Audi",
    popular: false,
    models: [
      { name: "A3", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "A4", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "A6", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Q3", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Q5", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Q7", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Q8", serviceIntervalKm: 15000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Geely",
    popular: false,
    models: [
      { name: "Coolray", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Azkarra", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Emgrand", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "GX3 Pro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Monjaro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Chery",
    popular: false,
    models: [
      { name: "Tiggo 2", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Tiggo 4 Pro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Tiggo 7 Pro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Tiggo 8 Pro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Arrizo 6", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "JAC",
    popular: false,
    models: [
      { name: "T6", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "T8 / T8 Pro", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Sunray", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "X200", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "JS4", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Dongfeng",
    popular: false,
    models: [
      { name: "Rich 6", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Rich 7", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "AX7", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Joyear T5 EVO", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Captain-T", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Citroën",
    popular: false,
    models: [
      { name: "C3", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "C4", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "C5 Aircross", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Berlingo", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Jumper", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Jumpy", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Dacia",
    popular: false,
    models: [
      { name: "Duster", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Logan", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Sandero", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Dokker", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Jeep",
    popular: false,
    models: [
      { name: "Grand Cherokee", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Wrangler", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Compass", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Renegade", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
  {
    name: "Tata",
    popular: false,
    models: [
      { name: "Xenon", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Telcoline", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Super Ace", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "LPT", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Foton",
    popular: false,
    models: [
      { name: "Tunland", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "View CS2", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
      { name: "Aumark", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "DIESEL" },
    ],
  },
  {
    name: "Chevrolet",
    popular: false,
    models: [
      { name: "Aveo", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Cruze", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Captiva", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Silverado", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
      { name: "Tahoe", serviceIntervalKm: 10000, serviceIntervalMonths: 12, defaultFuel: "PETROL" },
    ],
  },
];

/** Renvoie la liste de toutes les marques */
export function getCiVehicleMakes(): string[] {
  return CI_VEHICLE_CATALOG.map((m) => m.name);
}

/** Renvoie la liste des marques populaires (les plus répandues) */
export function getCiPopularMakes(): string[] {
  return CI_VEHICLE_CATALOG.filter((m) => m.popular).map((m) => m.name);
}

/** Renvoie les modèles d'une marque donnée (insensible à la casse) */
export function getCiVehicleModels(makeName: string): string[] {
  if (!makeName) return [];
  const normalized = makeName.trim().toLowerCase();
  const found = CI_VEHICLE_CATALOG.find(
    (m) =>
      m.name.toLowerCase() === normalized ||
      m.name.toLowerCase().includes(normalized) ||
      normalized.includes(m.name.toLowerCase()),
  );
  return found ? found.models.map((mod) => mod.name) : [];
}

/** Recherche rapide dans le catalogue */
export function searchCiCatalog(query: string): { make: string; model: string }[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const results: { make: string; model: string }[] = [];

  for (const m of CI_VEHICLE_CATALOG) {
    for (const mod of m.models) {
      if (
        m.name.toLowerCase().includes(q) ||
        mod.name.toLowerCase().includes(q) ||
        `${m.name} ${mod.name}`.toLowerCase().includes(q)
      ) {
        results.push({ make: m.name, model: mod.name });
      }
    }
  }

  return results;
}
