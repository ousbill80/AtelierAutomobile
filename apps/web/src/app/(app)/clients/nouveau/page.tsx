"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Car,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import { Button, PhoneInput, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

type CustomerType = "INDIVIDUAL" | "COMPANY";

export default function NewCustomerPage() {
  const router = useRouter();
  const [type, setType] = useState<CustomerType>("INDIVIDUAL");

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

  // Errors
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState("");

  const createCustomer = trpc.customer.create.useMutation({
    onSuccess: ({ customer }) => router.push(`/clients/${customer.id}`),
    onError: (error) => setDuplicateError(error.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicateError(null);

    const vehicle =
      plate && make && model ? { plate, make, model, vin: vin || undefined } : undefined;

    const commonFields = {
      phone: phone || undefined,
      email: email || undefined,
      commune: commune || undefined,
      address: address || undefined,
      vehicle,
      duplicateOverrideReason: duplicateOverrideReason || undefined,
    };

    if (type === "INDIVIDUAL") {
      createCustomer.mutate({
        type: "INDIVIDUAL",
        civility: civility || undefined,
        lastName,
        firstName: firstName || undefined,
        ...commonFields,
      });
    } else {
      createCustomer.mutate({
        type: "COMPANY",
        companyName,
        ncc: ncc || undefined,
        rccm: rccm || undefined,
        ...commonFields,
      });
    }
  }

  return (
    <div className="form-page-2col">
      {/* Header */}
      <div className="form-page-header">
        <Link href="/clients" className="form-back-link">
          <ArrowLeft size={18} />
          Retour aux clients
        </Link>
        <h1>Nouveau client</h1>
        <p>Remplissez les informations pour creer un nouveau client</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type selector - full width */}
        <div className="form-2col-full">
          <div className="form-card">
            <div className="form-card-title">Type de client</div>
            <div className="form-type-row">
              <button
                type="button"
                className={`form-type-card ${type === "INDIVIDUAL" ? "active" : ""}`}
                onClick={() => setType("INDIVIDUAL")}
              >
                <User size={24} />
                <div>
                  <strong>Particulier</strong>
                  <span>Personne physique</span>
                </div>
              </button>
              <button
                type="button"
                className={`form-type-card ${type === "COMPANY" ? "active" : ""}`}
                onClick={() => setType("COMPANY")}
              >
                <Building2 size={24} />
                <div>
                  <strong>Entreprise</strong>
                  <span>Societe, association</span>
                </div>
              </button>
            </div>
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
              <span className="form-card-subtitle">Optionnel - ajoutez un vehicule maintenant ou plus tard</span>
            </div>
            <div className="form-card-body">
              <div className="form-row-4">
                <div className="form-field">
                  <label>Plaque</label>
                  <PlateInput value={plate} onChange={setPlate} />
                </div>
                <div className="form-field">
                  <label>Marque</label>
                  <input
                    type="text"
                    className="input"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
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
                  placeholder="1HGBH41JXMN109186"
                  maxLength={17}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Duplicate warning */}
        {duplicateError && (
          <div className="form-2col-full">
            <div className="form-alert warn">
              <p>{duplicateError}</p>
              <div className="form-field" style={{ marginTop: 12 }}>
                <label>Motif pour creer quand meme</label>
                <input
                  type="text"
                  className="input"
                  value={duplicateOverrideReason}
                  onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                  placeholder="Numero partage, autre personne..."
                />
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="form-2col-actions">
          <Link href="/clients" className="btn btn-secondary">
            Annuler
          </Link>
          <Button type="submit" disabled={createCustomer.isPending}>
            {createCustomer.isPending ? "Enregistrement..." : "Enregistrer le client"}
          </Button>
        </div>
      </form>
    </div>
  );
}
