// Fragments de contexte de rendu (RG-M10-25) communs à l'aperçu (apps/web) et à l'envoi
// (apps/worker) : fonctions pures de transformation, les requêtes restent dans chaque app
// (01-architecture-technique.md — chaque app orchestre elle-même via `core`).

export interface ClientNamespaceInput {
  civility?: "M" | "MME" | "MLLE" | null;
  lastName?: string | null;
  displayName: string;
}

export function clientNamespace(customer: ClientNamespaceInput): {
  salutation: string;
  nomComplet: string;
} {
  const name = customer.lastName ?? customer.displayName;
  const salutation =
    customer.civility === "M"
      ? `M. ${name}`
      : customer.civility === "MME"
        ? `Mme ${name}`
        : customer.civility === "MLLE"
          ? `Mlle ${name}`
          : customer.displayName;
  return { salutation, nomComplet: customer.displayName };
}

export interface VehicleNamespaceInput {
  make: string;
  model: string;
  plate: string;
  estimatedMileage?: number | null;
}

export function vehicleNamespace(vehicle?: VehicleNamespaceInput | null): {
  marque: string;
  modele: string;
  plaque: string;
  kmEstime: string;
} {
  if (!vehicle) return { marque: "", modele: "", plaque: "", kmEstime: "" };
  return {
    marque: vehicle.make,
    modele: vehicle.model,
    plaque: vehicle.plate,
    kmEstime: vehicle.estimatedMileage != null ? `${vehicle.estimatedMileage} km` : "",
  };
}

export interface GarageNamespaceInput {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
}

const DEFAULT_GARAGE_HOURS = "Lun-Sam 08h00-19h00"; // Site.openingHours non agrégé ici (simplification)

export function garageNamespace(org: GarageNamespaceInput): {
  nom: string;
  telephone: string;
  adresse: string;
  horaires: string;
} {
  return {
    nom: org.name ?? "Notre garage",
    telephone: org.phone ?? "",
    adresse: [org.address, org.city].filter(Boolean).join(", "),
    horaires: DEFAULT_GARAGE_HOURS,
  };
}
