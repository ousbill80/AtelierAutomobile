"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Car, Phone, User } from "lucide-react";
import { Button, PhoneInput, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";

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
          {t("customers.form.backToList")}
        </Link>
        <h1>{t("customers.form.newTitle")}</h1>
        <p>{t("customers.form.newSubtitle")}</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type selector - full width */}
        <div className="form-2col-full">
          <div className="form-card">
            <div className="form-card-title">{t("customers.form.typeTitle")}</div>
            <div className="form-type-row">
              <button
                type="button"
                className={`form-type-card ${type === "INDIVIDUAL" ? "active" : ""}`}
                onClick={() => setType("INDIVIDUAL")}
              >
                <User size={24} />
                <div>
                  <strong>{t("customers.form.individual")}</strong>
                  <span>{t("customers.form.individualHint")}</span>
                </div>
              </button>
              <button
                type="button"
                className={`form-type-card ${type === "COMPANY" ? "active" : ""}`}
                onClick={() => setType("COMPANY")}
              >
                <Building2 size={24} />
                <div>
                  <strong>{t("customers.form.company")}</strong>
                  <span>{t("customers.form.companyHint")}</span>
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
                  <User size={18} /> {t("customers.form.identity")}
                </>
              ) : (
                <>
                  <Building2 size={18} /> {t("customers.form.company")}
                </>
              )}
            </div>

            {type === "INDIVIDUAL" ? (
              <div className="form-card-body">
                <div className="form-field">
                  <label htmlFor="customer-civility">{t("customers.form.civility")}</label>
                  <select
                    id="customer-civility"
                    className="select"
                    value={civility}
                    onChange={(e) => setCivility(e.target.value as typeof civility)}
                  >
                    <option value="">—</option>
                    <option value="M">{t("customers.form.civilityM")}</option>
                    <option value="MME">{t("customers.form.civilityMme")}</option>
                    <option value="MLLE">{t("customers.form.civilityMlle")}</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="customer-last-name">
                    {t("customers.form.lastName")}{" "}
                    <span className="required" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="customer-last-name"
                    type="text"
                    className="input"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t("customers.form.lastNamePlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-first-name">{t("customers.form.firstName")}</label>
                  <input
                    id="customer-first-name"
                    type="text"
                    className="input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t("customers.form.firstNamePlaceholder")}
                  />
                </div>
              </div>
            ) : (
              <div className="form-card-body">
                <div className="form-field">
                  <label htmlFor="customer-company-name">
                    {t("customers.form.companyName")}{" "}
                    <span className="required" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="customer-company-name"
                    type="text"
                    className="input"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t("customers.form.companyNamePlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-ncc">{t("customers.form.ncc")}</label>
                  <input
                    id="customer-ncc"
                    type="text"
                    className="input"
                    value={ncc}
                    onChange={(e) => setNcc(e.target.value)}
                    placeholder={t("customers.form.nccPlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-rccm">{t("customers.form.rccm")}</label>
                  <input
                    id="customer-rccm"
                    type="text"
                    className="input"
                    value={rccm}
                    onChange={(e) => setRccm(e.target.value)}
                    placeholder={t("customers.form.rccmPlaceholder")}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right column - Contact */}
          <div className="form-card">
            <div className="form-card-title">
              <Phone size={18} /> {t("customers.form.contact")}
            </div>
            <div className="form-card-body">
              <div className="form-field">
                <label htmlFor="customer-phone">{t("customers.form.phone")}</label>
                <PhoneInput id="customer-phone" value={phone} onChange={setPhone} />
              </div>
              <div className="form-field">
                <label htmlFor="customer-email">{t("customers.form.email")}</label>
                <input
                  id="customer-email"
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("customers.form.emailPlaceholder")}
                />
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="customer-commune">{t("customers.form.commune")}</label>
                  <input
                    id="customer-commune"
                    type="text"
                    className="input"
                    value={commune}
                    onChange={(e) => setCommune(e.target.value)}
                    placeholder={t("customers.form.communePlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-address">{t("customers.form.address")}</label>
                  <input
                    id="customer-address"
                    type="text"
                    className="input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t("customers.form.addressPlaceholder")}
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
              <Car size={18} /> {t("customers.form.vehicle")}
              <span className="form-card-subtitle">{t("customers.form.vehicleOptional")}</span>
            </div>
            <div className="form-card-body">
              <div className="form-row-4">
                <div className="form-field">
                  <label htmlFor="customer-plate">{t("customers.form.plate")}</label>
                  <PlateInput id="customer-plate" value={plate} onChange={setPlate} />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-make">{t("customers.form.make")}</label>
                  <input
                    id="customer-make"
                    type="text"
                    className="input"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    placeholder={t("customers.form.makePlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-model">{t("customers.form.model")}</label>
                  <input
                    id="customer-model"
                    type="text"
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={t("customers.form.modelPlaceholder")}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-year">{t("customers.form.year")}</label>
                  <input
                    id="customer-year"
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
                <label htmlFor="customer-vin">{t("customers.form.vin")}</label>
                <input
                  id="customer-vin"
                  type="text"
                  className="input"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                  placeholder={t("customers.form.vinPlaceholder")}
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
                <label htmlFor="customer-duplicate-override-reason">
                  {t("customers.form.duplicateReason")}
                </label>
                <input
                  id="customer-duplicate-override-reason"
                  type="text"
                  className="input"
                  value={duplicateOverrideReason}
                  onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                  placeholder={t("customers.form.duplicateReasonPlaceholder")}
                />
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="form-2col-actions">
          <Link href="/clients" className="btn btn-secondary">
            {t("customers.form.cancel")}
          </Link>
          <Button type="submit" disabled={createCustomer.isPending}>
            {createCustomer.isPending ? t("customers.form.saving") : t("customers.form.saveNew")}
          </Button>
        </div>
      </form>
    </div>
  );
}
