"use client";

// M05 US-M05-02 — nouveau devis libre : client existant ou prospect (nom + téléphone),
// véhicule facultatif. Les lignes s'ajoutent ensuite dans l'éditeur.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Car, Search, User, UserPlus } from "lucide-react";
import { normalizePhoneCI } from "@atelieros/core/src/phone";
import { Button, Input, PhoneInput, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/quotes/i18n";

type Mode = "existing" | "prospect";

function phoneReady(value: string) {
  if (!value.trim()) return false;
  try {
    return Boolean(normalizePhoneCI(value).e164);
  } catch {
    return false;
  }
}

export default function NewQuotePage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const canCreateCustomer = me.data ? new Set(me.data.permissions).has("customer:create") : true;
  const [mode, setMode] = useState<Mode>("existing");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{
    id: string;
    displayName: string;
    phone: string | null;
  } | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const search = trpc.customer.list.useQuery(
    { q: q.trim(), limit: 8 },
    { enabled: mode === "existing" && q.trim().length >= 2 && !customer },
  );
  const detail = trpc.customer.get.useQuery(
    { id: customer?.id ?? "" },
    { enabled: mode === "existing" && !!customer },
  );
  const create = trpc.quote.create.useMutation({
    onSuccess: (res) => router.push(`/devis/${res.id}`),
  });

  const prospectOk = name.trim().length >= 2 && phoneReady(phone);
  const canSubmit = mode === "prospect" ? canCreateCustomer && prospectOk : !!customer;
  const vehicles = detail.data?.vehicles ?? [];

  function chooseExisting() {
    setMode("existing");
    create.reset();
  }

  function chooseProspect(prefill?: string) {
    if (!canCreateCustomer) return;
    setMode("prospect");
    setCustomer(null);
    setVehicleId("");
    if (prefill && !name.trim()) setName(prefill);
    create.reset();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || create.isPending) return;
    create.mutate(
      mode === "prospect"
        ? { newCustomer: { name: name.trim(), phone }, origin: "STANDALONE" }
        : {
            customerId: customer!.id,
            vehicleId: vehicleId || undefined,
            origin: "STANDALONE",
          },
    );
  }

  return (
    <div className="form-page-2col">
      <Link href="/devis" className="form-back-link">
        ← {t("back")}
      </Link>
      <header className="form-page-header">
        <h1>{t("newTitle")}</h1>
        <p>{t("create.subtitle")}</p>
      </header>

      <form onSubmit={onSubmit}>
        <div className="form-2col-grid">
          <section className="form-card">
            <div className="form-card-title">
              <User aria-hidden />
              {t("create.searchCustomer")}
              <span className="form-card-subtitle">{t("create.required")}</span>
            </div>
            <div className="form-type-row max-[700px]:flex-col">
              <button
                type="button"
                className={`form-type-card min-w-0 ${mode === "existing" ? "active" : ""}`}
                aria-pressed={mode === "existing"}
                onClick={chooseExisting}
              >
                <Search size={22} aria-hidden />
                <div>
                  <strong>{t("create.modeExisting")}</strong>
                  <span>{t("create.modeExistingHint")}</span>
                </div>
              </button>
              <button
                type="button"
                className={`form-type-card min-w-0 disabled:cursor-not-allowed disabled:opacity-50 ${mode === "prospect" ? "active" : ""}`}
                aria-pressed={mode === "prospect"}
                disabled={!canCreateCustomer}
                title={canCreateCustomer ? undefined : t("create.noPermission")}
                onClick={() => chooseProspect()}
              >
                <UserPlus size={22} aria-hidden />
                <div>
                  <strong>{t("create.modeProspect")}</strong>
                  <span>{t("create.modeProspectHint")}</span>
                </div>
              </button>
            </div>

            <div className="form-card-body">
              {mode === "existing" ? (
                customer ? (
                  <div className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{customer.displayName}</span>
                      {customer.phone && (
                        <span className="block truncate text-sm text-muted">{customer.phone}</span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setCustomer(null);
                        setVehicleId("");
                      }}
                    >
                      {t("create.change")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="form-field">
                      <Input
                        id="quote-customer-search"
                        aria-label={t("create.searchCustomer")}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t("create.searchPlaceholder")}
                        autoComplete="off"
                      />
                      {q.trim().length < 2 && (
                        <span className="text-xs text-muted">{t("create.searchHint")}</span>
                      )}
                    </div>
                    {q.trim().length >= 2 && search.isFetching && (
                      <p className="text-sm text-muted">{t("create.searching")}</p>
                    )}
                    {(search.data?.items.length ?? 0) > 0 && (
                      <ul className="flex flex-col gap-1" aria-label={t("create.searchCustomer")}>
                        {search.data?.items.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:border-accent"
                              onClick={() => {
                                setCustomer({
                                  id: c.id,
                                  displayName: c.displayName,
                                  phone: c.phone,
                                });
                                setQ("");
                                setVehicleId("");
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{c.displayName}</span>
                                {c.phone && (
                                  <span className="block truncate text-xs text-muted">
                                    {c.phone}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-xs text-muted">
                                {t("create.vehiclesCount", { count: c.vehicleCount })}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.trim().length >= 2 && search.data && search.data.items.length === 0 && (
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-sm text-muted">
                          {t("create.noResult", { query: q.trim() })}
                        </p>
                        {canCreateCustomer && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => chooseProspect(q.trim())}
                          >
                            {t("create.useAsProspect")}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )
              ) : (
                <>
                  <div className="form-field">
                    <label htmlFor="prospect-name">
                      {t("create.prospectName")} <span className="required">*</span>
                    </label>
                    <Input
                      id="prospect-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="prospect-phone">
                      {t("create.prospectPhone")} <span className="required">*</span>
                    </label>
                    <PhoneInput id="prospect-phone" value={phone} onChange={setPhone} />
                    <span className="text-xs text-muted">{t("create.prospectPhoneHint")}</span>
                  </div>
                </>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-5">
            <section className="form-card">
              <div className="form-card-title">
                <Car aria-hidden />
                {t("create.vehicleTitle")}
                <span className="form-card-subtitle">{t("create.optional")}</span>
              </div>
              <div className="form-card-body">
                {mode === "prospect" ? (
                  <p className="text-sm text-muted">{t("create.vehicleProspect")}</p>
                ) : !customer ? (
                  <p className="text-sm text-muted">{t("create.vehicleWait")}</p>
                ) : detail.isLoading ? (
                  <p className="text-sm text-muted">{t("create.vehicleLoading")}</p>
                ) : (
                  <>
                    <div className="form-field">
                      <label htmlFor="quote-vehicle">{t("fields.vehicle")}</label>
                      <Select
                        id="quote-vehicle"
                        value={vehicleId}
                        onChange={(e) => setVehicleId(e.target.value)}
                      >
                        <option value="">{t("create.noVehicle")}</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.plate} — {v.make} {v.model}
                          </option>
                        ))}
                      </Select>
                      <span className="text-xs text-muted">
                        {vehicles.length === 0 ? t("create.vehicleEmpty") : t("create.vehicleHint")}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="form-card">
              <div className="form-card-title">{t("create.stepsTitle")}</div>
              <ol className="form-card-body list-decimal space-y-2 pl-9 text-sm text-muted [display:block]">
                <li>{t("create.stepDraft")}</li>
                <li>{t("create.stepLines")}</li>
                <li>{t("create.stepSend")}</li>
              </ol>
            </section>
          </div>
        </div>

        {create.error && (
          <p role="alert" className="text-sm text-status-bad">
            ⚠ {create.error.message}
          </p>
        )}

        <div className="form-2col-actions">
          <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
            {t("create.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
