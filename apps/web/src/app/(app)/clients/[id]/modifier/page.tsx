"use client";

import { useState, type FormEvent, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Car,
  Phone,
  User,
} from "lucide-react";
import { Button, PhoneInput, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

type CustomerType = "INDIVIDUAL" | "COMPANY";

export default function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  // Fetch customer data
  const { data: customer, isLoading } = trpc.customer.get.useQuery({ id });

  // Form state - initialized from customer data
  const [type, setType] = useState<CustomerType>("INDIVIDUAL");
  const [initialized, setInitialized] = useState(false);

  // Particulier
  const [civility, setCivility] = useState<"M" | "MME" | "MLLE" | "">("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");

  // Entreprise
  const [companyName, setCompanyName] = useState("");
  const [ncc, setNcc] = useState("");
  const [rccm, setRccm] = useState("");

  // Contact
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [commune, setCommune] = useState("");
  const [address, setAddress] = useState("");

  // Vehicule
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [vin, setVin] = useState("");

  // Error
  const [error, setError] = useState<string | null>(null);

  // Initialize form when customer data loads
  if (customer && !initialized) {
    setType(customer.type as CustomerType);
    if (customer.type === "INDIVIDUAL") {
      setCivility((customer.civility as typeof civility) ?? "");
      setLastName(customer.lastName ?? "");
      setFirstName(customer.firstName ?? "");
    } else {
      setCompanyName(customer.companyName ?? "");
      setNcc(customer.ncc ?? "");
      setRccm(customer.rccm ?? "");
    }
    setPhone(customer.phone ?? "");
    setEmail(customer.email ?? "");
    setCommune(customer.commune ?? "");
    setAddress(customer.address ?? "");
    // Premier vehicule s'il existe
    if (customer.vehicles && customer.vehicles.length > 0) {
      const v = customer.vehicles[0];
      setPlate(v.plate ?? "");
      setMake(v.make ?? "");
      setModel(v.model ?? "");
      setYear(v.year?.toString() ?? "");
      setVin(v.vin ?? "");
    }
    setInitialized(true);
  }

  const updateCustomer = trpc.customer.update.useMutation({
    onSuccess: () => router.push(`/clients/${id}`),
    onError: (e) => setError(e.message),
  });

  const addVehicle = trpc.vehicle.create.useMutation({
    onSuccess: () => router.push(`/clients/${id}`),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // D'abord mettre à jour le client - le schéma attend { id, patch: {...} }
    const patch = type === "INDIVIDUAL"
      ? {
          civility: civility || null,
          lastName,
          firstName: firstName || null,
          phone: phone || null,
          email: email || null,
          commune: commune || null,
          address: address || null,
        }
      : {
          companyName,
          ncc: ncc || null,
          rccm: rccm || null,
          phone: phone || null,
          email: email || null,
          commune: commune || null,
          address: address || null,
        };

    updateCustomer.mutate({ id, patch }, {
      onSuccess: () => {
        // Si un nouveau véhicule est renseigné (plaque + marque + modèle), l'ajouter
        const hasExistingVehicle = customer?.vehicles && customer.vehicles.length > 0;
        const isNewVehicle = plate && make && model && !hasExistingVehicle;

        if (isNewVehicle) {
          addVehicle.mutate({
            customerId: id,
            plate,
            make,
            model,
            year: year ? parseInt(year, 10) : undefined,
            vin: vin || undefined,
          });
        } else {
          router.push(`/clients/${id}`);
        }
      },
    });
  }

  if (isLoading) {
    return (
      <div className="form-page-2col">
        <div className="form-page-header">
          <Link href={`/clients/${id}`} className="form-back-link">
            <ArrowLeft size={18} />
            Retour
          </Link>
          <h1>Chargement...</h1>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="form-page-2col">
        <div className="form-page-header">
          <Link href="/clients" className="form-back-link">
            <ArrowLeft size={18} />
            Retour aux clients
          </Link>
          <h1>Client introuvable</h1>
        </div>
      </div>
    );
  }

  const hasExistingVehicle = customer.vehicles && customer.vehicles.length > 0;

  return (
    <div className="form-page-2col">
      {/* Header */}
      <div className="form-page-header">
        <Link href={`/clients/${id}`} className="form-back-link">
          <ArrowLeft size={18} />
          Retour
        </Link>
        <h1>Modifier le client</h1>
        <p>{customer.displayName}</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type display (read-only) */}
        <div className="form-2col-full">
          <div className="form-card">
            <div className="form-card-title">Type de client</div>
            <div className="form-type-row">
              <div
                className={`form-type-card ${type === "INDIVIDUAL" ? "active" : ""}`}
                style={{ cursor: "default", opacity: type === "INDIVIDUAL" ? 1 : 0.5 }}
              >
                <User size={24} />
                <div>
                  <strong>Particulier</strong>
                  <span>Personne physique</span>
                </div>
              </div>
              <div
                className={`form-type-card ${type === "COMPANY" ? "active" : ""}`}
                style={{ cursor: "default", opacity: type === "COMPANY" ? 1 : 0.5 }}
              >
                <Building2 size={24} />
                <div>
                  <strong>Entreprise</strong>
                  <span>Societe, association</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted mt-2">
              Le type de client ne peut pas etre modifie apres creation.
            </p>
          </div>
        </div>

        {/* Two columns: Identity + Contact */}
        <div className="form-2col-grid">
          {/* Left column - Identity */}
          <div className="form-card">
            <div className="form-card-title">
              {type === "INDIVIDUAL" ? (
                <>
                  <User size={18} /> Identite
                </>
              ) : (
                <>
                  <Building2 size={18} /> Entreprise
                </>
              )}
            </div>

            {type === "INDIVIDUAL" ? (
              <div className="form-card-body">
                <div className="form-field">
                  <label>Civilite</label>
                  <select
                    className="select"
                    value={civility}
                    onChange={(e) => setCivility(e.target.value as typeof civility)}
                  >
                    <option value="">—</option>
                    <option value="M">M.</option>
                    <option value="MME">Mme</option>
                    <option value="MLLE">Mlle</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>
                    Nom <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="KOULIBALI"
                  />
                </div>
                <div className="form-field">
                  <label>Prenom(s)</label>
                  <input
                    type="text"
                    className="input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jean-Marc"
                  />
                </div>
              </div>
            ) : (
              <div className="form-card-body">
                <div className="form-field">
                  <label>
                    Raison sociale <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="SOTRA Logistique SARL"
                  />
                </div>
                <div className="form-field">
                  <label>N° Contribuable (NCC)</label>
                  <input
                    type="text"
                    className="input"
                    value={ncc}
                    onChange={(e) => setNcc(e.target.value)}
                    placeholder="CI-ABJ-2024-XXXXX"
                  />
                </div>
                <div className="form-field">
                  <label>RCCM</label>
                  <input
                    type="text"
                    className="input"
                    value={rccm}
                    onChange={(e) => setRccm(e.target.value)}
                    placeholder="CI-ABJ-2024-B-XXXXX"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right column - Contact */}
          <div className="form-card">
            <div className="form-card-title">
              <Phone size={18} /> Coordonnees
            </div>
            <div className="form-card-body">
              <div className="form-field">
                <label>Telephone</label>
                <PhoneInput value={phone} onChange={setPhone} />
              </div>
              <div className="form-field">
                <label>Email</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@email.com"
                />
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label>Commune</label>
                  <input
                    type="text"
                    className="input"
                    value={commune}
                    onChange={(e) => setCommune(e.target.value)}
                    placeholder="Cocody"
                  />
                </div>
                <div className="form-field">
                  <label>Adresse</label>
                  <input
                    type="text"
                    className="input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Rue des Jardins"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Vehicle section - full width */}
        <div className="form-2col-full">
          <div className="form-card">
            <div className="form-card-title">
              <Car size={18} /> Vehicule
              <span className="form-card-subtitle">
                {hasExistingVehicle
                  ? `${customer.vehicles!.length} vehicule(s) enregistre(s)`
                  : "Optionnel - ajoutez un vehicule maintenant ou plus tard"}
              </span>
            </div>
            <div className="form-card-body">
              <div className="form-row-4">
                <div className="form-field">
                  <label>Plaque</label>
                  <PlateInput
                    value={plate}
                    onChange={setPlate}
                    disabled={hasExistingVehicle}
                  />
                </div>
                <div className="form-field">
                  <label>Marque</label>
                  <input
                    type="text"
                    className="input"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    disabled={hasExistingVehicle}
                    placeholder="Toyota"
                  />
                </div>
                <div className="form-field">
                  <label>Modele</label>
                  <input
                    type="text"
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={hasExistingVehicle}
                    placeholder="Corolla"
                  />
                </div>
                <div className="form-field">
                  <label>Annee</label>
                  <input
                    type="text"
                    className="input"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    disabled={hasExistingVehicle}
                    placeholder="2020"
                    maxLength={4}
                  />
                </div>
              </div>
              <div className="form-field">
                <label>VIN (chassis)</label>
                <input
                  type="text"
                  className="input"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                  disabled={hasExistingVehicle}
                  placeholder="1HGBH41JXMN109186"
                  maxLength={17}
                />
              </div>
              {hasExistingVehicle && (
                <p className="text-sm text-muted mt-2">
                  Pour modifier ou ajouter d&apos;autres vehicules, allez sur la fiche client.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="form-2col-full">
            <p className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad">
              {error}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="form-2col-actions">
          <Link href={`/clients/${id}`} className="btn btn-secondary">
            Annuler
          </Link>
          <Button type="submit" disabled={updateCustomer.isPending || addVehicle.isPending}>
            {updateCustomer.isPending || addVehicle.isPending
              ? "Enregistrement..."
              : "Enregistrer les modifications"}
          </Button>
        </div>
      </form>
    </div>
  );
}
