"use client";

// M16 — fiche compagnie (RG-M16-01) : contacts, conditions, pièces exigées, paliers de relance.
import { useState } from "react";
import { Button, CheckboxRow, Field, Input, MoneyInput } from "@atelieros/ui";
import { ATTACHMENT_KINDS, t } from "./i18n";

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

export function InsurerForm({
  initial,
  pending,
  error,
  onSubmit,
}: {
  initial: InsurerFormValue;
  pending: boolean;
  error: string | null;
  onSubmit: (v: InsurerFormValue) => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof InsurerFormValue>(k: K, value: InsurerFormValue[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));
  const text = (k: keyof InsurerFormValue, type = "text") => (
    <Input
      label={t(`fields.${k}`)}
      type={type}
      value={String(v[k] ?? "")}
      onChange={(e) => set(k, e.target.value as never)}
    />
  );
  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      {text("name")}
      {text("legalName")}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text("ncc")}
        {text("rccm")}
      </div>
      {text("address")}
      {text("claimsContactName")}
      {text("claimsPhone", "tel")}
      {text("claimsEmail", "email")}
      {text("accountingEmail", "email")}
      <Input
        label={t("fields.paymentTermsDays")}
        type="number"
        min={0}
        max={365}
        value={v.paymentTermsDays}
        onChange={(e) => set("paymentTermsDays", Number.parseInt(e.target.value || "0", 10))}
      />
      <Field label={t("fields.laborRate")}>
        <MoneyInput value={v.laborRate} onChange={(x) => set("laborRate", x)} />
      </Field>
      <Input
        label={t("fields.partsDiscountRate")}
        type="number"
        min={0}
        max={100}
        value={v.partsDiscountRate ?? ""}
        onChange={(e) =>
          set(
            "partsDiscountRate",
            e.target.value === "" ? null : Number.parseInt(e.target.value, 10),
          )
        }
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t("fields.requiredDocuments")}</legend>
        {ATTACHMENT_KINDS.map((k) => (
          <CheckboxRow
            key={k}
            label={t(`kinds.${k}`)}
            checked={v.requiredDocuments.includes(k)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              set(
                "requiredDocuments",
                e.target.checked
                  ? [...v.requiredDocuments, k]
                  : v.requiredDocuments.filter((x) => x !== k),
              )
            }
          />
        ))}
      </fieldset>
      {text("approvalSteps")}
      {text("paymentSteps")}
      <CheckboxRow
        label={t("fields.isActive")}
        checked={v.isActive}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("isActive", e.target.checked)}
      />
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      <Button type="submit" loading={pending} className="min-h-11 self-start">
        {t("save")}
      </Button>
    </form>
  );
}
