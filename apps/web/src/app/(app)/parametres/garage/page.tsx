"use client";

// M15 §7 `/parametres/garage` — identité légale (US-M15-01, RG-M15-01), TVA (US-M15-02,
// RG-M15-02), mentions de facture (RG-M15-03) et aperçu en direct de l'en-tête de facture.
// Écriture : `org:update` (identité, TVA, mentions) et `settings:update` (taux secondaires,
// arrondi) ; sans ces permissions, la page s'affiche en lecture seule.
import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Button,
  Card,
  CheckboxRow,
  Field,
  Input,
  PageHead,
  Select,
  StatusBadge,
  Textarea,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type Org = inferRouterOutputs<AppRouter>["org"]["get"];
type Tax = inferRouterOutputs<AppRouter>["settings"]["get"]["tax"];

const TAX_REGIMES = ["RNI", "RSI", "RMI", "ENTREPRENANT"] as const;
type TaxRegime = (typeof TAX_REGIMES)[number];
const ROUNDINGS = ["PER_LINE", "PER_DOCUMENT"] as const;
type Rounding = (typeof ROUNDINGS)[number];

const NCC_REGEX = /^\d{7}[A-Z]$/;
const RCCM_REGEX = /^CI-[A-Z]{3}-\d{4}-[A-Z]-\d{1,6}$/;
const FOOTER_MAX = 500;

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-2" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function GarageSettingsPage() {
  const me = trpc.me.get.useQuery();
  const org = trpc.org.get.useQuery();
  const settings = trpc.settings.get.useQuery({ section: "tax" });

  if (org.isError || settings.isError || me.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm text-status-bad">{t("garageSettings.loadError")}</p>
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => {
            void org.refetch();
            void settings.refetch();
            void me.refetch();
          }}
        >
          {t("garageSettings.retry")}
        </Button>
      </div>
    );
  }
  if (!org.data || !settings.data || !me.data) return <Skeleton />;

  const permissions = new Set(me.data.permissions);
  return (
    <GarageForm
      org={org.data}
      tax={settings.data.tax}
      canEditOrg={permissions.has("org:update")}
      canEditTax={permissions.has("settings:update")}
    />
  );
}

function GarageForm({
  org,
  tax,
  canEditOrg,
  canEditTax,
}: {
  org: Org;
  tax: Tax;
  canEditOrg: boolean;
  canEditTax: boolean;
}) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const [name, setName] = useState(org.name);
  const [legalName, setLegalName] = useState(org.legalName ?? "");
  const [rccm, setRccm] = useState(org.rccm ?? "");
  const [ncc, setNcc] = useState(org.ncc ?? "");
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(org.taxRegime as TaxRegime);
  const [address, setAddress] = useState(org.address ?? "");
  const [city, setCity] = useState(org.city ?? "");
  const [phone, setPhone] = useState(org.phone ?? "");
  const [email, setEmail] = useState(org.email ?? "");
  const [vatEnabled, setVatEnabled] = useState(org.vatEnabled);
  const [vatRate, setVatRate] = useState(String(org.vatRate));
  const [rates, setRates] = useState(tax.rates.join(", "));
  const [rounding, setRounding] = useState<Rounding>(tax.rounding as Rounding);
  const [invoiceFooter, setInvoiceFooter] = useState(org.invoiceFooter ?? "");
  const [logo, setLogo] = useState<string | null>(org.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateOrg = trpc.org.update.useMutation();
  const updateSettings = trpc.settings.update.useMutation();
  const saving = updateOrg.isPending || updateSettings.isPending;
  const readOnly = !canEditOrg && !canEditTax;

  const nccValue = ncc.trim().toUpperCase();
  const nccError = nccValue && !NCC_REGEX.test(nccValue) ? t("garageSettings.nccInvalid") : null;
  const rccmValue = rccm.trim().toUpperCase();
  const rccmWarning = rccmValue && !RCCM_REGEX.test(rccmValue);
  const nameError = name.trim() ? null : t("garageSettings.nameRequired");
  const emailValue = email.trim();
  const emailError =
    emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)
      ? t("garageSettings.emailInvalid")
      : null;
  const phoneDigits = phone.replace(/\D/g, "").replace(/^(00)?225(?=\d{10}$)/, "");
  const phoneError =
    phone.trim() && phoneDigits.length !== 10 && phoneDigits.length !== 8
      ? t("garageSettings.phoneInvalid")
      : null;
  const vatRateNumber = Number(vatRate);
  const vatRateError =
    vatEnabled &&
    (vatRate.trim() === "" ||
      !Number.isInteger(vatRateNumber) ||
      vatRateNumber < 0 ||
      vatRateNumber > 100)
      ? t("garageSettings.vatRateInvalid")
      : null;
  const parsedRates = rates
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((r) => Number(r));
  const ratesError =
    parsedRates.length < 1 ||
    parsedRates.length > 5 ||
    parsedRates.some((r) => !Number.isInteger(r) || r < 0 || r > 100)
      ? t("garageSettings.ratesInvalid")
      : null;
  const footerError =
    invoiceFooter.trim().length > FOOTER_MAX
      ? t("garageSettings.footerTooLong", { max: FOOTER_MAX })
      : null;

  const orgErrors = canEditOrg
    ? [nameError, nccError, emailError, phoneError, vatRateError, footerError, logoError]
    : [];
  const taxErrors = canEditTax ? [ratesError] : [];
  const hasErrors = [...orgErrors, ...taxErrors].some(Boolean);
  const microRegime = taxRegime === "ENTREPRENANT" || taxRegime === "RMI";

  // Barre d'enregistrement : signale les modifications non enregistrées.
  const snapshot = JSON.stringify([
    name,
    legalName,
    rccm,
    ncc,
    taxRegime,
    address,
    city,
    phone,
    email,
    vatEnabled,
    vatRate,
    rates,
    rounding,
    invoiceFooter,
    logo,
  ]);
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;

  function pickLogo(file: File) {
    const type = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    const isImage =
      type === "image/png" ||
      type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/pjpeg" ||
      (type === "" && /\.(png|jpe?g)$/.test(fileName));
    if (!isImage) {
      setLogoError(t("garageSettings.logoInvalid"));
      return;
    }
    if (file.size > 1_000_000) {
      setLogoError(t("garageSettings.logoTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(typeof reader.result === "string" ? reader.result : null);
      setLogoError(null);
    };
    reader.readAsDataURL(file);
  }

  function proposeVatDisable() {
    setVatEnabled(false);
    if (!invoiceFooter.trim()) setInvoiceFooter(t("garageSettings.vatExemptMention"));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setSaved(false);
    setServerError(null);
    if (hasErrors || readOnly) return;
    const orNull = (value: string) => (value.trim() ? value.trim() : null);
    try {
      if (canEditOrg) {
        await updateOrg.mutateAsync({
          name: name.trim(),
          legalName: orNull(legalName),
          rccm: rccmValue || null,
          ncc: nccValue || null,
          taxRegime,
          address: orNull(address),
          city: orNull(city),
          phone: orNull(phone),
          email: emailValue || null,
          vatEnabled,
          vatRate: vatEnabled ? vatRateNumber : 0,
          invoiceFooter: orNull(invoiceFooter),
          logoUrl: logo,
        });
      }
      if (canEditTax) {
        await updateSettings.mutateAsync({
          section: "tax",
          values: { rates: parsedRates, rounding },
        });
      }
      setSaved(true);
      setBaseline(snapshot);
      void utils.settings.get.invalidate();
      void utils.org.get.invalidate();
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t("garageSettings.saveError"));
    }
  }

  const displayName = legalName.trim() || name.trim();
  const previewVat = vatEnabled
    ? t("garageSettings.previewVat", { rate: vatRateError ? "—" : vatRateNumber })
    : t("garageSettings.previewNoVat");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHead title={t("garageSettings.title")} description={t("garageSettings.description")} />

      {readOnly ? (
        <p role="note" className="text-sm text-muted">
          🔒 {t("garageSettings.readOnly")}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-6" noValidate>
          <Card title={t("garageSettings.identityTitle")}>
            <Field
              label={t("garageSettings.logo")}
              hint={t("garageSettings.logoHint")}
              error={logoError}
            >
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  {logo ? (
                    // Le logo est une data URL choisie par le gérant, pas une URL distante.
                    <img
                      src={logo}
                      alt=""
                      className="h-12 max-w-40 rounded-lg border border-border bg-surface object-contain"
                    />
                  ) : (
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg"
                      aria-hidden
                    >
                      {displayName
                        .split(/\s+/)
                        .filter((word) => word && !/^(sarl|sa|sas)$/i.test(word))
                        .slice(0, 2)
                        .map((word) => word[0]?.toUpperCase())
                        .join("") || "G"}
                    </span>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) pickLogo(file);
                    }}
                  />
                  {canEditOrg ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => fileRef.current?.click()}
                    >
                      <ImageUp size={16} aria-hidden />
                      {logo ? t("garageSettings.logoChange") : t("garageSettings.logoPick")}
                    </Button>
                  ) : null}
                  {logo && canEditOrg ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => setLogo(null)}
                    >
                      {t("garageSettings.logoRemove")}
                    </Button>
                  ) : null}
                </div>
                {!logo ? (
                  <p className="text-xs text-muted">{t("garageSettings.logoEmpty")}</p>
                ) : null}
              </div>
            </Field>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label={t("garageSettings.legalName")} hint={t("garageSettings.legalNameHint")}>
                <Input
                  className="min-h-11"
                  value={legalName}
                  disabled={!canEditOrg}
                  onChange={(e) => setLegalName(e.target.value)}
                />
              </Field>
              <Field
                label={t("garageSettings.name")}
                error={submitted || !name.trim() ? nameError : null}
              >
                <Input
                  className="min-h-11"
                  value={name}
                  disabled={!canEditOrg}
                  required
                  invalid={Boolean(nameError)}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label={t("garageSettings.rccm")}
                hint={rccmWarning ? undefined : t("garageSettings.rccmHint")}
              >
                <Input
                  className="min-h-11"
                  value={rccm}
                  disabled={!canEditOrg}
                  placeholder="CI-ABJ-2019-B-12345"
                  onChange={(e) => setRccm(e.target.value.toUpperCase())}
                />
              </Field>
              <Field
                label={t("garageSettings.ncc")}
                hint={t("garageSettings.nccHint")}
                error={nccError}
              >
                <Input
                  className="min-h-11"
                  value={ncc}
                  disabled={!canEditOrg}
                  placeholder="1912345A"
                  invalid={Boolean(nccError)}
                  onChange={(e) => setNcc(e.target.value.toUpperCase())}
                />
              </Field>
              {rccmWarning ? (
                <p role="status" className="text-sm text-status-warn sm:col-span-2">
                  ⚠ {t("garageSettings.rccmWarning")}
                </p>
              ) : null}
              <Field label={t("garageSettings.taxRegime")}>
                <Select
                  className="min-h-11"
                  value={taxRegime}
                  disabled={!canEditOrg}
                  onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}
                >
                  {TAX_REGIMES.map((regime) => (
                    <option key={regime} value={regime}>
                      {t(`garageSettings.regimes.${regime}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title={t("garageSettings.contactTitle")}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={t("garageSettings.address")}>
                  <Input
                    className="min-h-11"
                    value={address}
                    disabled={!canEditOrg}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Field>
              </div>
              <Field label={t("garageSettings.city")}>
                <Input
                  className="min-h-11"
                  value={city}
                  disabled={!canEditOrg}
                  onChange={(e) => setCity(e.target.value)}
                />
              </Field>
              <Field
                label={t("garageSettings.phone")}
                hint={t("garageSettings.phoneHint")}
                error={phoneError}
              >
                <Input
                  className="min-h-11"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  disabled={!canEditOrg}
                  placeholder="+225 07 00 00 00 00"
                  invalid={Boolean(phoneError)}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field label={t("garageSettings.email")} error={emailError}>
                <Input
                  className="min-h-11"
                  type="email"
                  value={email}
                  disabled={!canEditOrg}
                  invalid={Boolean(emailError)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card title={t("garageSettings.vatTitle")}>
            <div className="flex min-w-0 flex-col gap-3">
              {microRegime && vatEnabled ? (
                <div
                  role="status"
                  className="flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
                >
                  <p>ℹ {t("garageSettings.vatSuggestion")}</p>
                  {canEditOrg ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={proposeVatDisable}
                    >
                      {t("garageSettings.vatDisableAction")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="min-h-11">
                <CheckboxRow
                  label={t("garageSettings.vatEnabled")}
                  checked={vatEnabled}
                  disabled={!canEditOrg}
                  onChange={(e) => setVatEnabled(e.target.checked)}
                />
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field
                  label={t("garageSettings.vatRate")}
                  hint={t("garageSettings.vatRateHint")}
                  error={vatRateError}
                >
                  <Input
                    className="min-h-11"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={vatEnabled ? vatRate : "0"}
                    disabled={!canEditOrg || !vatEnabled}
                    invalid={Boolean(vatRateError)}
                    onChange={(e) => setVatRate(e.target.value)}
                  />
                </Field>
                <Field
                  label={t("garageSettings.rates")}
                  hint={t("garageSettings.ratesHint")}
                  error={ratesError}
                >
                  <Input
                    className="min-h-11"
                    value={rates}
                    disabled={!canEditTax}
                    invalid={Boolean(ratesError)}
                    onChange={(e) => setRates(e.target.value)}
                  />
                </Field>
                <Field label={t("garageSettings.rounding")}>
                  <Select
                    className="min-h-11"
                    value={rounding}
                    disabled={!canEditTax}
                    onChange={(e) => setRounding(e.target.value as Rounding)}
                  >
                    {ROUNDINGS.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`garageSettings.roundings.${mode}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-muted">{t("garageSettings.vatNewDocumentsOnly")}</p>
            </div>
          </Card>

          <Card title={t("garageSettings.mentionsTitle")}>
            <Field
              label={t("garageSettings.invoiceFooter")}
              hint={t("garageSettings.footerCount", {
                count: invoiceFooter.trim().length,
                max: FOOTER_MAX,
              })}
              error={footerError}
            >
              <Textarea
                rows={4}
                value={invoiceFooter}
                disabled={!canEditOrg}
                maxLength={FOOTER_MAX}
                invalid={Boolean(footerError)}
                placeholder={t("garageSettings.footerPlaceholder")}
                onChange={(e) => setInvoiceFooter(e.target.value)}
              />
            </Field>
          </Card>

          {!readOnly ? (
            <div className="sticky bottom-[calc(var(--bottom-nav-offset,0px)+0.5rem)] z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
              <p
                role={serverError || (submitted && hasErrors) ? "alert" : "status"}
                className={`min-w-0 flex-1 text-sm ${
                  serverError || (submitted && hasErrors)
                    ? "text-status-bad"
                    : dirty
                      ? "text-status-warn"
                      : saved
                        ? "text-status-ok"
                        : "text-muted"
                }`}
              >
                {serverError
                  ? `✕ ${serverError}`
                  : submitted && hasErrors
                    ? `✕ ${t("garageSettings.fixErrors")}`
                    : dirty
                      ? `● ${t("garageSettings.unsaved")}`
                      : saved
                        ? `✓ ${t("garageSettings.saved")}`
                        : t("garageSettings.upToDate")}
              </p>
              <Button type="submit" className="min-h-11" loading={saving} disabled={!dirty}>
                {t("garageSettings.save")}
              </Button>
            </div>
          ) : null}
        </form>

        <aside className="min-w-0" aria-label={t("garageSettings.previewTitle")}>
          <Card title={t("garageSettings.previewTitle")} className="lg:sticky lg:top-4">
            <div className="flex min-w-0 flex-col gap-1 break-words text-sm">
              {logo ? (
                <img src={logo} alt="" className="mb-1 h-12 max-w-40 object-contain" />
              ) : null}
              <p className="text-base font-semibold">
                {displayName || t("garageSettings.previewNoName")}
              </p>
              {legalName.trim() && name.trim() && legalName.trim() !== name.trim() ? (
                <p className="text-muted">{name.trim()}</p>
              ) : null}
              {address.trim() || city.trim() ? (
                <p>{[address.trim(), city.trim()].filter(Boolean).join(", ")}</p>
              ) : null}
              {phone.trim() || emailValue ? (
                <p>{[phone.trim(), emailValue].filter(Boolean).join(" · ")}</p>
              ) : null}
              <p>
                {t("garageSettings.previewRccm")} {rccmValue || "—"} ·{" "}
                {t("garageSettings.previewNcc")} {nccValue || "—"}
              </p>
              <p>
                {t("garageSettings.previewRegime")} {t(`garageSettings.regimes.${taxRegime}`)}
              </p>
              <div className="mt-1">
                <StatusBadge tone={vatEnabled ? "ok" : "off"} label={previewVat} />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-muted">
                {invoiceFooter.trim() || t("garageSettings.previewNoFooter")}
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
