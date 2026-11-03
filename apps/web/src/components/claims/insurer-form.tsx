"use client";

// M16 — fiche compagnie (RG-M16-01) : contacts, conditions, pièces exigées, paliers de relance.
import { useState, type ReactNode } from "react";
import { Button, Field, Input, MoneyInput, PhoneInput, Switch } from "@atelieros/ui";
import { ATTACHMENT_KINDS, t } from "./i18n";

const NCC_REGEX = /^\d{7}[A-Z]$/;
const RCCM_REGEX = /^CI-[A-Z]{3}-\d{4}-[A-Z]-\d{1,6}$/;

function emailError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? null : t("fields.emailInvalid");
}

type Kind = (typeof ATTACHMENT_KINDS)[number];

export interface InsurerFormValue {
  name: string;
  legalName: string;
  ncc: string;
  rccm: string;
  address: string;
  claimsContactName: string;
  claimsPhone: string;
  claimsEmail: string;
  accountingEmail: string;
  paymentTermsDays: number;
  laborRate: number | null;
  partsDiscountRate: number | null;
  requiredDocuments: Kind[];
  approvalSteps: string;
  paymentSteps: string;
  isActive: boolean;
}

export const EMPTY_INSURER: InsurerFormValue = {
  name: "",
  legalName: "",
  ncc: "",
  rccm: "",
  address: "",
  claimsContactName: "",
  claimsPhone: "",
  claimsEmail: "",
  accountingEmail: "",
  paymentTermsDays: 60,
  laborRate: null,
  partsDiscountRate: null,
  requiredDocuments: ["claim_report", "photo_damage", "registration", "insurance_certificate"],
  approvalSteps: "7, 14, 21",
  paymentSteps: "0, 15, 30",
  isActive: true,
};

const steps = (s: string) =>
  s
    .split(/[,; ]+/)
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);

export function insurerPayload(v: InsurerFormValue) {
  return {
    name: v.name,
    legalName: v.legalName,
    ncc: v.ncc,
    rccm: v.rccm,
    address: v.address,
    claimsContactName: v.claimsContactName,
    claimsPhone: v.claimsPhone,
    claimsEmail: v.claimsEmail,
    accountingEmail: v.accountingEmail,
    paymentTermsDays: v.paymentTermsDays,
    laborRate: v.laborRate,
    partsDiscountRate: v.partsDiscountRate,
    requiredDocuments: v.requiredDocuments,
    followUpConfig: { approval: steps(v.approvalSteps), payment: steps(v.paymentSteps) },
    isActive: v.isActive,
  };
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Unit({ children }: { children: string }) {
  return <span className="input-suffix">{children}</span>;
}

export function InsurerForm({
  initial,
  pending,
  error,
  onSubmit,
  formId = "insurer-form",
  showSubmit = true,
  autoFocusName = false,
}: {
  initial: InsurerFormValue;
  pending: boolean;
  error: string | null;
  onSubmit: (v: InsurerFormValue) => void;
  formId?: string;
  showSubmit?: boolean;
  autoFocusName?: boolean;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof InsurerFormValue>(k: K, value: InsurerFormValue[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));
  const ncc = v.ncc.trim().toUpperCase();
  const rccm = v.rccm.trim().toUpperCase();
  const nccError = !ncc || NCC_REGEX.test(ncc) ? null : t("fields.nccInvalid");
  const rccmWarning = !rccm || RCCM_REGEX.test(rccm) ? null : t("fields.rccmWarning");
  const claimsEmailError = emailError(v.claimsEmail);
  const accountingEmailError = emailError(v.accountingEmail);

  return (
    <form
      id={formId}
      className="insurer-fields flex w-full min-w-0 flex-col gap-6 [&_.field]:mb-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (nccError || claimsEmailError || accountingEmailError) return;
        onSubmit(v);
      }}
    >
      <Block title={t("sections.identity")} hint={t("sections.identityHint")}>
        <Field label={t("fields.name")} hint={t("fields.nameHint")}>
          <Input
            value={v.name}
            required
            minLength={2}
            autoFocus={autoFocusName}
            autoComplete="organization"
            placeholder={t("fields.namePlaceholder")}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label={t("fields.legalName")} hint={t("fields.legalNameHint")}>
          <Input
            value={v.legalName}
            autoComplete="organization"
            placeholder={t("fields.legalNamePlaceholder")}
            onChange={(e) => set("legalName", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={t("fields.ncc")}
            hint={nccError ? undefined : t("fields.nccHint")}
            error={nccError}
          >
            <Input
              value={v.ncc}
              invalid={Boolean(nccError)}
              spellCheck={false}
              autoCapitalize="characters"
              placeholder={t("fields.nccPlaceholder")}
              onChange={(e) => set("ncc", e.target.value.toUpperCase())}
            />
          </Field>
          <div>
            <Field label={t("fields.rccm")} hint={rccmWarning ? undefined : t("fields.rccmHint")}>
              <Input
                value={v.rccm}
                spellCheck={false}
                autoCapitalize="characters"
                placeholder={t("fields.rccmPlaceholder")}
                onChange={(e) => set("rccm", e.target.value.toUpperCase())}
              />
            </Field>
            {rccmWarning ? (
              <p className="mt-1 text-xs text-status-warn" role="status">
                {rccmWarning}
              </p>
            ) : null}
          </div>
        </div>
        <Field label={t("fields.address")}>
          <Input
            value={v.address}
            autoComplete="street-address"
            placeholder={t("fields.addressPlaceholder")}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[var(--bg)] px-3 py-2">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t("fields.isActive")}</span>
            <span className="block text-xs text-muted">{t("fields.isActiveHint")}</span>
          </span>
          <Switch
            checked={v.isActive}
            label={t("fields.isActive")}
            onChange={(e) => set("isActive", e.target.checked)}
          />
        </div>
      </Block>
      <Block title={t("sections.contact")} hint={t("sections.contactHint")}>
        <Field label={t("fields.claimsContactName")}>
          <Input
            value={v.claimsContactName}
            autoComplete="name"
            placeholder={t("fields.claimsContactPlaceholder")}
            onChange={(e) => set("claimsContactName", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("fields.claimsPhone")}>
            <PhoneInput
              value={v.claimsPhone}
              placeholder={t("fields.phonePlaceholder")}
              onChange={(value) => set("claimsPhone", value)}
            />
          </Field>
          <Field label={t("fields.claimsEmail")} error={claimsEmailError}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={v.claimsEmail}
              invalid={Boolean(claimsEmailError)}
              placeholder={t("fields.claimsEmailPlaceholder")}
              onChange={(e) => set("claimsEmail", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label={t("fields.accountingEmail")}
          hint={accountingEmailError ? undefined : t("fields.accountingEmailHint")}
          error={accountingEmailError}
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={v.accountingEmail}
            invalid={Boolean(accountingEmailError)}
            placeholder={t("fields.accountingEmailPlaceholder")}
            onChange={(e) => set("accountingEmail", e.target.value)}
          />
        </Field>
      </Block>
      <Block title={t("sections.terms")} hint={t("sections.termsHint")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("fields.paymentTermsDays")} hint={t("fields.paymentTermsHint")}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={v.paymentTermsDays}
              rightAction={<Unit>{t("fields.daysUnit")}</Unit>}
              onChange={(e) => set("paymentTermsDays", Number.parseInt(e.target.value || "0", 10))}
            />
          </Field>
          <Field label={t("fields.partsDiscountRate")} hint={t("fields.discountHint")}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={v.partsDiscountRate ?? ""}
              placeholder="0"
              rightAction={<Unit>{t("fields.percentUnit")}</Unit>}
              onChange={(e) =>
                set(
                  "partsDiscountRate",
                  e.target.value === "" ? null : Number.parseInt(e.target.value, 10),
                )
              }
            />
          </Field>
        </div>
        <Field label={t("fields.laborRate")} hint={t("fields.laborRateHint")}>
          <MoneyInput
            value={v.laborRate}
            placeholder={t("fields.laborRatePlaceholder")}
            onChange={(x) => set("laborRate", x)}
          />
        </Field>
      </Block>
      <Block title={t("sections.documents")} hint={t("sections.documentsHint")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ATTACHMENT_KINDS.map((k) => {
            const checked = v.requiredDocuments.includes(k);
            return (
              <label
                key={k}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${
                  checked ? "border-accent bg-[var(--bg)]" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={checked}
                  onChange={(e) =>
                    set(
                      "requiredDocuments",
                      e.target.checked
                        ? [...v.requiredDocuments, k]
                        : v.requiredDocuments.filter((x) => x !== k),
                    )
                  }
                />
                {t(`kinds.${k}`)}
              </label>
            );
          })}
        </div>
      </Block>
      <Block title={t("sections.followUp")} hint={t("sections.followUpHint")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("fields.approvalSteps")} hint={t("fields.approvalStepsHint")}>
            <Input
              value={v.approvalSteps}
              inputMode="numeric"
              spellCheck={false}
              placeholder={t("fields.approvalStepsPlaceholder")}
              onChange={(e) => set("approvalSteps", e.target.value)}
            />
          </Field>
          <Field label={t("fields.paymentSteps")} hint={t("fields.paymentStepsHint")}>
            <Input
              value={v.paymentSteps}
              inputMode="numeric"
              spellCheck={false}
              placeholder={t("fields.paymentStepsPlaceholder")}
              onChange={(e) => set("paymentSteps", e.target.value)}
            />
          </Field>
        </div>
      </Block>
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      {showSubmit && (
        <Button type="submit" loading={pending} className="min-h-11 self-start">
          {t("save")}
        </Button>
      )}
    </form>
  );
}
