"use client";

import { useState, type FormEvent } from "react";
import {
  Building2,
  Car,
  Phone,
  User,
} from "lucide-react";
import { Button } from "./Button";
import { PhoneInput } from "./PhoneInput";
import { PlateInput } from "./PlateInput";

type CustomerType = "INDIVIDUAL" | "COMPANY";

interface CustomerFormDataBase {
  phone?: string;
  email?: string;
  commune?: string;
  address?: string;
  vehicle?: {
    plate: string;
    make: string;
    model: string;
    year?: string;
    vin?: string;
  };
}

interface IndividualCustomerFormData extends CustomerFormDataBase {
  type: "INDIVIDUAL";
  civility?: "M" | "MME" | "MLLE";
  lastName: string;
  firstName?: string;
}

interface CompanyCustomerFormData extends CustomerFormDataBase {
  type: "COMPANY";
  companyName: string;
  ncc?: string;
  rccm?: string;
}

export type CustomerFormData = IndividualCustomerFormData | CompanyCustomerFormData;

/** For setting initial values, we need a flat structure since we can't use Partial on discriminated unions */
export interface CustomerFormInitialValues {
  type?: CustomerType;
  // Individual
  civility?: "M" | "MME" | "MLLE";
  lastName?: string;
  firstName?: string;
  // Company
  companyName?: string;
  ncc?: string;
  rccm?: string;
  // Contact
  phone?: string;
  email?: string;
  commune?: string;
  address?: string;
  // Vehicle
  vehicle?: {
    plate: string;
    make: string;
    model: string;
    year?: string;
    vin?: string;
  };
}

export interface CustomerFormProps {
  onSubmit: (data: CustomerFormData) => void;
  isPending?: boolean;
  error?: string | null;
  /** Show duplicate override field when an error is returned */
  showDuplicateOverride?: boolean;
  duplicateOverrideReason?: string;
  onDuplicateOverrideChange?: (reason: string) => void;
  /** Compact mode hides vehicle section and shows single column */
  compact?: boolean;
  /** Show cancel button */
  onCancel?: () => void;
  /** Initial values for editing */
  initialValues?: CustomerFormInitialValues;
}

export function CustomerForm({
  onSubmit,
  isPending = false,
  error,
  showDuplicateOverride = false,
  duplicateOverrideReason = "",
  onDuplicateOverrideChange,
  compact = false,
  onCancel,
  initialValues,
}: CustomerFormProps) {
  const [type, setType] = useState<CustomerType>(initialValues?.type ?? "INDIVIDUAL");

  // Individual
  const [civility, setCivility] = useState<"M" | "MME" | "MLLE" | "">(
    initialValues?.civility ?? ""
  );
  const [lastName, setLastName] = useState(initialValues?.lastName ?? "");
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? "");

  // Company
  const [companyName, setCompanyName] = useState(initialValues?.companyName ?? "");
  const [ncc, setNcc] = useState(initialValues?.ncc ?? "");
  const [rccm, setRccm] = useState(initialValues?.rccm ?? "");

  // Contact
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [commune, setCommune] = useState(initialValues?.commune ?? "");
  const [address, setAddress] = useState(initialValues?.address ?? "");

  // Vehicle
  const [plate, setPlate] = useState(initialValues?.vehicle?.plate ?? "");
  const [make, setMake] = useState(initialValues?.vehicle?.make ?? "");
  const [model, setModel] = useState(initialValues?.vehicle?.model ?? "");
  const [year, setYear] = useState(initialValues?.vehicle?.year ?? "");
  const [vin, setVin] = useState(initialValues?.vehicle?.vin ?? "");

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    e?.stopPropagation();

    // Validation basique
    if (type === "INDIVIDUAL" && !lastName.trim()) {
      return;
    }
    if (type === "COMPANY" && !companyName.trim()) {
      return;
    }

    const vehicle =
      plate && make && model ? { plate, make, model, year: year || undefined, vin: vin || undefined } : undefined;

    const data: CustomerFormData =
      type === "INDIVIDUAL"
        ? {
            type: "INDIVIDUAL",
            civility: civility || undefined,
            lastName,
            firstName: firstName || undefined,
            phone: phone || undefined,
            email: email || undefined,
            commune: commune || undefined,
            address: address || undefined,
            vehicle,
          }
        : {
            type: "COMPANY",
            companyName,
            ncc: ncc || undefined,
            rccm: rccm || undefined,
            phone: phone || undefined,
            email: email || undefined,
            commune: commune || undefined,
            address: address || undefined,
            vehicle,
          };

    onSubmit(data);
  }

  if (compact) {
    // En mode compact (dans un modal), on utilise un <div> au lieu de <form>
    // pour éviter l'imbrication de formulaires qui cause des bugs de soumission
    return (
      <div className="flex flex-col gap-4">
        {/* Type selector */}
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-2 rounded-md border p-3 text-sm transition-colors ${
              type === "INDIVIDUAL"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface hover:bg-surface-2"
            }`}
            onClick={() => setType("INDIVIDUAL")}
          >
            <User size={18} />
            Particulier
          </button>
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-2 rounded-md border p-3 text-sm transition-colors ${
              type === "COMPANY"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface hover:bg-surface-2"
            }`}
            onClick={() => setType("COMPANY")}
          >
            <Building2 size={18} />
            Entreprise
          </button>
        </div>

        {type === "INDIVIDUAL" ? (
          <>
            <div className="form-field">
              <label className="text-sm font-medium">Civilité</label>
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
              <label className="text-sm font-medium">
                Nom <span className="text-status-bad">*</span>
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
              <label className="text-sm font-medium">Prénom(s)</label>
              <input
                type="text"
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jean-Marc"
              />
            </div>
          </>
        ) : (
          <>
            <div className="form-field">
              <label className="text-sm font-medium">
                Raison sociale <span className="text-status-bad">*</span>
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
              <label className="text-sm font-medium">N° Contribuable (NCC)</label>
              <input
                type="text"
                className="input"
                value={ncc}
                onChange={(e) => setNcc(e.target.value)}
                placeholder="CI-ABJ-2024-XXXXX"
              />
            </div>
            <div className="form-field">
              <label className="text-sm font-medium">RCCM</label>
              <input
                type="text"
                className="input"
                value={rccm}
                onChange={(e) => setRccm(e.target.value)}
                placeholder="CI-ABJ-2024-B-XXXXX"
              />
            </div>
          </>
        )}

        {/* Contact */}
        <div className="form-field">
          <label className="text-sm font-medium">Téléphone</label>
          <PhoneInput value={phone} onChange={setPhone} />
        </div>
        <div className="form-field">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@email.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-field">
            <label className="text-sm font-medium">Commune</label>
            <input
              type="text"
              className="input"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              placeholder="Cocody"
            />
          </div>
          <div className="form-field">
            <label className="text-sm font-medium">Adresse</label>
            <input
              type="text"
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rue des Jardins"
            />
          </div>
        </div>

        {/* Vehicle section - also in compact mode */}
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Car size={16} />
            Véhicule (optionnel)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-field">
              <label className="text-sm font-medium">Plaque</label>
              <PlateInput value={plate} onChange={setPlate} />
            </div>
            <div className="form-field">
              <label className="text-sm font-medium">Marque</label>
              <input
                type="text"
                className="input"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Toyota"
              />
            </div>
            <div className="form-field">
              <label className="text-sm font-medium">Modèle</label>
              <input
                type="text"
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Corolla"
              />
            </div>
            <div className="form-field">
              <label className="text-sm font-medium">Année</label>
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
        </div>

        {/* Duplicate override */}
        {showDuplicateOverride && error && (
          <div className="rounded-md border border-status-warn bg-status-warn-bg p-3">
            <p className="mb-2 text-sm text-status-warn">{error}</p>
            <div className="form-field">
              <label className="text-sm font-medium">Motif pour créer quand même</label>
              <input
                type="text"
                className="input"
                value={duplicateOverrideReason}
                onChange={(e) => onDuplicateOverrideChange?.(e.target.value)}
                placeholder="Numéro partagé, autre personne..."
              />
            </div>
          </div>
        )}

        {error && !showDuplicateOverride && (
          <p className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
          )}
          <Button type="button" disabled={isPending} onClick={() => handleSubmit()}>
            {isPending ? "Enregistrement..." : "Créer le client"}
          </Button>
        </div>
      </div>
    );
  }

  // Full form (2-column layout)
  return (
    <div className="form-page-2col">
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
                  <span>Société, association</span>
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
                  <User size={18} /> Identité
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
                  <label>Civilité</label>
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
                  <label>Prénom(s)</label>
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
              <Phone size={18} /> Coordonnées
            </div>
            <div className="form-card-body">
              <div className="form-field">
                <label>Téléphone</label>
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
              <Car size={18} /> Véhicule
              <span className="form-card-subtitle">Optionnel - ajoutez un véhicule maintenant ou plus tard</span>
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
                  <label>Modèle</label>
                  <input
                    type="text"
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Corolla"
                  />
                </div>
                <div className="form-field">
                  <label>Année</label>
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
        {showDuplicateOverride && error && (
          <div className="form-2col-full">
            <div className="form-alert warn">
              <p>{error}</p>
              <div className="form-field" style={{ marginTop: 12 }}>
                <label>Motif pour créer quand même</label>
                <input
                  type="text"
                  className="input"
                  value={duplicateOverrideReason}
                  onChange={(e) => onDuplicateOverrideChange?.(e.target.value)}
                  placeholder="Numéro partagé, autre personne..."
                />
              </div>
            </div>
          </div>
        )}

        {error && !showDuplicateOverride && (
          <div className="form-2col-full">
            <p className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad">
              {error}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="form-2col-actions">
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Annuler
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Enregistrement..." : "Enregistrer le client"}
          </Button>
        </div>
      </form>
    </div>
  );
}
