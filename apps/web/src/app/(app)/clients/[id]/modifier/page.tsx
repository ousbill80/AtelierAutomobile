"use client";

import { useState, type FormEvent, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Car, Phone, User } from "lucide-react";
import { Button, PhoneInput, PlateInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";

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
    const patch =
      type === "INDIVIDUAL"
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

    updateCustomer.mutate(
      { id, patch },
      {
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
      },
    );
  }

  if (isLoading) {
    return (
      <div className="form-page-2col">
        <div className="form-page-header">
          <Link href={`/clients/${id}`} className="form-back-link">
            <ArrowLeft size={18} />
            {t("customers.form.back")}
          </Link>
          <h1>{t("customers.form.loading")}</h1>
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
            {t("customers.form.backToList")}
          </Link>
          <h1>{t("customers.form.notFound")}</h1>
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
          {t("customers.form.back")}
        </Link>
        <h1>{t("customers.form.editTitle")}</h1>
        <p>{customer.displayName}</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type display (read-only) */}
        <div className="form-2col-full">
          <div className="form-card">
            <div className="form-card-title">{t("customers.form.typeTitle")}</div>
            <div className="form-type-row">
              <div
                className={`form-type-card ${type === "INDIVIDUAL" ? "active" : ""}`}
                style={{ cursor: "default", opacity: type === "INDIVIDUAL" ? 1 : 0.5 }}
              >
                <User size={24} />
                <div>
                  <strong>{t("customers.form.individual")}</strong>
                  <span>{t("customers.form.individualHint")}</span>
                </div>
              </div>
              <div
                className={`form-type-card ${type === "COMPANY" ? "active" : ""}`}
                style={{ cursor: "default", opacity: type === "COMPANY" ? 1 : 0.5 }}
              >
                <Building2 size={24} />
                <div>
                  <strong>{t("customers.form.company")}</strong>
                  <span>{t("customers.form.companyHint")}</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted mt-2">{t("customers.form.typeLocked")}</p>
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
              <span className="form-card-subtitle">
                {hasExistingVehicle
                  ? t("customers.form.vehicleCount", { count: customer.vehicles!.length })
                  : t("customers.form.vehicleOptional")}
              </span>
            </div>
            <div className="form-card-body">
              <div className="form-row-4">
                <div className="form-field">
                  <label htmlFor="customer-plate">{t("customers.form.plate")}</label>
                  <PlateInput
                    id="customer-plate"
                    value={plate}
                    onChange={setPlate}
                    disabled={hasExistingVehicle}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-make">{t("customers.form.make")}</label>
                  <input
                    id="customer-make"
                    type="text"
                    className="input"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    disabled={hasExistingVehicle}
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
                    disabled={hasExistingVehicle}
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
                    disabled={hasExistingVehicle}
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
                  disabled={hasExistingVehicle}
                  placeholder={t("customers.form.vinPlaceholder")}
                  maxLength={17}
                />
              </div>
              {hasExistingVehicle && (
                <p className="text-sm text-muted mt-2">{t("customers.form.vehicleEditHint")}</p>
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
            {t("customers.form.cancel")}
          </Link>
          <Button type="submit" disabled={updateCustomer.isPending || addVehicle.isPending}>
            {updateCustomer.isPending || addVehicle.isPending
              ? t("customers.form.saving")
              : t("customers.form.saveEdit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
