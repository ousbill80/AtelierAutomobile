/**
 * RG-M13-06 — Table des synonymes connus par champ cible. Les clés des
 * synonymes sont déjà normalisées (voir `normalizeHeader` dans `mapping.ts`) :
 * minuscules, sans accents, ponctuation → espace, espaces multiples réduits.
 */
export type TargetField =
  | "customer.displayName"
  | "customer.firstName"
  | "customer.lastName"
  | "customer.phone"
  | "customer.phone2"
  | "customer.email"
  | "customer.type"
  | "customer.ncc"
  | "vehicle.plate"
  | "vehicle.make"
  | "vehicle.model"
  | "vehicle.vin"
  | "vehicle.year"
  | "vehicle.inspectionExpiryDate"
  | "vehicle.lastServiceDate"
  | "vehicle.lastServiceMileage"
  | "vehicle.currentMileage"
  | "invoice.externalNumber"
  | "invoice.issuedAt"
  | "invoice.dueDate"
  | "invoice.total"
  | "invoice.amountPaid"
  | "invoice.balance"
  | "payment.amount"
  | "payment.method"
  | "payment.receivedAt"
  | "product.sku"
  | "product.name"
  | "product.salePrice"
  | "product.onHand";

/** Synonymes déjà normalisés (voir RG-M13-05/06). */
export const SYNONYMS: Record<TargetField, readonly string[]> = {
  "customer.displayName": [
    "nom",
    "nom prenoms",
    "nom et prenoms",
    "client",
    "raison sociale",
    "nom client",
    "designation client",
  ],
  "customer.firstName": ["prenom", "prenoms"],
  "customer.lastName": ["nom de famille", "nom"],
  "customer.phone": [
    "telephone",
    "tel",
    "portable",
    "cel",
    "cellulaire",
    "mobile",
    "contact",
    "numero",
    "gsm",
  ],
  "customer.phone2": ["tel 2", "autre telephone", "fixe", "bureau"],
  "customer.email": ["email", "e mail", "courriel", "mail"],
  "customer.type": ["type client", "categorie", "particulier entreprise"],
  "customer.ncc": ["ncc", "compte contribuable", "n cc", "numero contribuable"],
  "vehicle.plate": ["immatriculation", "immat", "plaque", "n immat", "matricule"],
  "vehicle.make": ["marque", "type vehicule"],
  "vehicle.model": ["modele", "type vehicule"],
  "vehicle.vin": ["vin", "chassis", "n chassis", "numero de serie"],
  "vehicle.year": ["annee", "annee fabrication", "an"],
  "vehicle.inspectionExpiryDate": [
    "date vt",
    "expiration vt",
    "fin visite",
    "prochaine visite",
    "validite vt",
  ],
  "vehicle.lastServiceDate": ["derniere revision", "date vidange"],
  "vehicle.lastServiceMileage": ["km revision", "km vidange"],
  "vehicle.currentMileage": ["km", "kilometrage", "compteur"],
  "invoice.externalNumber": ["n facture", "numero facture", "facture", "ref facture", "piece"],
  "invoice.issuedAt": ["date facture"],
  "invoice.dueDate": ["date echeance", "echeance", "date limite"],
  "invoice.total": ["montant ttc", "total", "net a payer"],
  "invoice.amountPaid": ["regle", "paye", "verse"],
  "invoice.balance": ["reste", "reste a payer", "solde", "du"],
  "payment.amount": ["montant", "encaisse"],
  "payment.method": ["mode", "mode reglement"],
  "payment.receivedAt": ["date reglement"],
  "product.sku": ["reference", "code article"],
  "product.name": ["designation", "libelle"],
  "product.salePrice": ["prix vente", "pv"],
  "product.onHand": ["stock", "quantite", "qte"],
};

/** Champs cibles groupés par entité, pour les menus de correspondance manuelle. */
export const TARGET_FIELDS_BY_ENTITY: Record<string, readonly TargetField[]> = {
  customers: [
    "customer.displayName",
    "customer.firstName",
    "customer.lastName",
    "customer.phone",
    "customer.phone2",
    "customer.email",
    "customer.type",
    "customer.ncc",
  ],
  vehicles: [
    "vehicle.plate",
    "vehicle.make",
    "vehicle.model",
    "vehicle.vin",
    "vehicle.year",
    "vehicle.inspectionExpiryDate",
    "vehicle.lastServiceDate",
    "vehicle.lastServiceMileage",
    "vehicle.currentMileage",
  ],
  invoices: [
    "invoice.externalNumber",
    "invoice.issuedAt",
    "invoice.dueDate",
    "invoice.total",
    "invoice.amountPaid",
    "invoice.balance",
  ],
  payments: ["payment.amount", "payment.method", "payment.receivedAt"],
  products: ["product.sku", "product.name", "product.salePrice", "product.onHand"],
};
