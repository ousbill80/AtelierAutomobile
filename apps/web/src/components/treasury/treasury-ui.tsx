"use client";

// M18 — briques d'écran de la trésorerie : type de compte, montant signé (couleur + icône +
// signe), graphique entrées / sorties, fenêtres (compte, virement, dépense hors caisse, autre
// mouvement, contre-passation, rapprochement).
import { useRef, useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Camera,
  CircleCheck,
  Hourglass,
  Landmark,
  Lock,
  Paperclip,
  Smartphone,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Modal, MoneyInput, Select, Textarea, compressImage } from "@atelieros/ui";
import { t } from "@/components/billing/i18n";
import { signedFCFA } from "@/components/cash/cash-ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { tt } from "./i18n";

type Outputs = inferRouterOutputs<AppRouter>;
export type TreasuryOverview = Outputs["treasury"]["overview"];
export type TreasuryAccount = Outputs["treasury"]["accounts"][number];
export type AccountType = TreasuryAccount["type"];

export const ACCOUNT_ICON: Record<AccountType, LucideIcon> = {
  CASH_REGISTER: Wallet,
  SAFE: Lock,
  BANK: Landmark,
  MOBILE_MONEY: Smartphone,
  OTHER: Banknote,
};

export const ROUTABLE_METHODS = [
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "BANK_TRANSFER",
  "CARD",
  "CHEQUE",
  "INSURANCE",
  "OTHER",
] as const;

export function AccountIcon({ type, size = 18 }: { type: AccountType; size?: number }) {
  const Icon = ACCOUNT_ICON[type];
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground">
      <Icon size={size} aria-hidden />
    </span>
  );
}

/** Montant d'un mouvement : couleur + icône + signe, jamais la couleur seule. */
export function SignedAmount({
  direction,
  amount,
  muted,
}: {
  direction: "IN" | "OUT";
  amount: number;
  muted?: boolean;
}) {
  const Icon = direction === "IN" ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap tabular-nums ${
        muted
          ? "text-muted line-through"
          : direction === "IN"
            ? "text-status-ok"
            : "text-foreground"
      }`}
    >
      <Icon size={14} aria-label={tt(`direction.${direction}`)} />
      {direction === "IN" ? "+" : "−"}
      {formatFCFA(amount)}
    </span>
  );
}

/** Jour civil courant (`yyyy-MM-dd`) dans un fuseau — pour les valeurs par défaut des formulaires. */
export function today(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Entrées / sorties par période : barres groupées (bleu = entrées, orange = sorties, paire
 * validée CVD), légende, infobulle au survol ou au focus, valeurs dans le tableau voisin.
 */
export function InOutChart({
  series,
  labelOf,
}: {
  series: { key: string; inflow: number; outflow: number }[];
  labelOf: (key: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => [s.inflow, s.outflow]));
  const empty = series.every((s) => s.inflow === 0 && s.outflow === 0);
  const every = Math.ceil(series.length / 8);
  const active = hover !== null ? series[hover] : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--chart-in)" }} />
          {tt("reports.inflow")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--chart-out)" }} />
          {tt("reports.outflow")}
        </span>
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted">{tt("reports.chartEmpty")}</p>
      ) : (
        <div className="relative">
          <div
            className="flex h-44 items-end gap-1 border-b border-border"
            role="img"
            aria-label={tt("reports.chart")}
            onMouseLeave={() => setHover(null)}
          >
            {series.map((s, i) => (
              <div
                key={s.key}
                className={`flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-t px-px ${
                  hover === i ? "bg-surface-2" : ""
                }`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${labelOf(s.key)} : ${tt("reports.inflow")} ${formatFCFA(s.inflow)}, ${tt("reports.outflow")} ${formatFCFA(s.outflow)}`}
              >
                <div
                  className="w-full max-w-4 rounded-t-[4px]"
                  style={{
                    height: `${(s.inflow / max) * 100}%`,
                    minHeight: s.inflow > 0 ? 2 : 0,
                    background: "var(--chart-in)",
                  }}
                />
                <div
                  className="w-full max-w-4 rounded-t-[4px]"
                  style={{
                    height: `${(s.outflow / max) * 100}%`,
                    minHeight: s.outflow > 0 ? 2 : 0,
                    background: "var(--chart-out)",
                  }}
                />
              </div>
            ))}
          </div>
          {active && hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 min-w-40 -translate-y-full rounded-md border border-border bg-surface p-2 text-xs shadow-md"
              style={{
                left: `clamp(0px, calc(${((hover + 0.5) / series.length) * 100}% - 80px), calc(100% - 160px))`,
              }}
            >
              <div className="mb-1 font-semibold">{labelOf(active.key)}</div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">{tt("reports.inflow")}</span>
                <span className="tabular-nums">{formatFCFA(active.inflow)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">{tt("reports.outflow")}</span>
                <span className="tabular-nums">{formatFCFA(active.outflow)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 font-semibold">
                <span>{tt("reports.net")}</span>
                <span className="tabular-nums">{signedFCFA(active.inflow - active.outflow)}</span>
              </div>
            </div>
          )}
          <div className="mt-1 flex gap-1 text-[11px] text-muted" aria-hidden>
            {series.map((s, i) => (
              <span key={s.key} className="min-w-0 flex-1 truncate text-center">
                {i % every === 0 ? labelOf(s.key) : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorLine({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-status-bad">
      <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Footer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <Button variant="secondary" className="min-h-11" onClick={onClose}>
        {tt("cancel")}
      </Button>
      {children}
    </>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="text-[13px] font-semibold">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </label>
  );
}

function DateField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="text-[13px] font-semibold">{label}</span>
      <input
        type="date"
        className="input"
        value={value}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const accountOption = (a: TreasuryAccount) => `${a.name} — ${formatFCFA(a.balance)}`;

async function readReceipt(f: File): Promise<{ name: string; mimeType: string; base64: string }> {
  if (f.type === "application/pdf") {
    const buf = new Uint8Array(await f.arrayBuffer());
    let binary = "";
    for (const byte of buf) binary += String.fromCharCode(byte);
    return { name: f.name, mimeType: f.type, base64: btoa(binary) };
  }
  const img = await compressImage(f, 1600, 0.8);
  return { name: f.name, mimeType: img.mimeType, base64: img.base64 };
}

// ── Compte ────────────────────────────────────────────────────────────────────────────────

export function AccountModal({
  account,
  sites,
  takenMethods,
  todayKey,
  onClose,
  onDone,
}: {
  account?: TreasuryAccount;
  sites: { id: string; name: string }[];
  /** Mode → nom du compte qui l'encaisse déjà. */
  takenMethods: Record<string, string>;
  todayKey: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = Boolean(account);
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "BANK");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [methods, setMethods] = useState<string[]>(account?.paymentMethods ?? []);
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [accountRef, setAccountRef] = useState("");
  const [ledgerAccount, setLedgerAccount] = useState(account?.ledgerAccount ?? "");
  const [openingBalance, setOpeningBalance] = useState<number | null>(0);
  const [openingDate, setOpeningDate] = useState(todayKey);
  const create = trpc.treasury.createAccount.useMutation({
    onSuccess: () => onDone(tt("accountForm.created")),
  });
  const update = trpc.treasury.updateAccount.useMutation({
    onSuccess: () => onDone(tt("accountForm.updated")),
  });
  const pending = create.isPending || update.isPending;
  const error = create.error?.message ?? update.error?.message;
  const toggle = (m: string) =>
    setMethods((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));
  const submit = () => {
    if (editing && account) {
      update.mutate({
        id: account.id,
        name,
        paymentMethods: methods as never,
        bankName: bankName || undefined,
        accountRef: accountRef || undefined,
        ledgerAccount: ledgerAccount || undefined,
      });
    } else {
      create.mutate({
        name,
        type,
        siteId: type === "CASH_REGISTER" ? siteId : undefined,
        paymentMethods: methods as never,
        bankName: bankName || undefined,
        accountRef: accountRef || undefined,
        ledgerAccount: ledgerAccount || undefined,
        openingBalance: openingBalance ?? 0,
        openingDate,
      });
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={editing ? tt("accountForm.editTitle") : tt("accountForm.createTitle")}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Button className="min-h-11" loading={pending} disabled={!name.trim()} onClick={submit}>
            {tt("save")}
          </Button>
        </Footer>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Input
          label={tt("accountForm.name")}
          placeholder={tt("accountForm.namePlaceholder")}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        {editing ? (
          <div className="field">
            <span className="text-[13px] font-semibold">{tt("accountForm.type")}</span>
            <span className="flex h-12 items-center text-sm">{tt(`types.${type}`)}</span>
          </div>
        ) : (
          <SelectField
            label={tt("accountForm.type")}
            value={type}
            onChange={(v) => setType(v as AccountType)}
          >
            {(["BANK", "MOBILE_MONEY", "SAFE", "CASH_REGISTER", "OTHER"] as const).map((k) => (
              <option key={k} value={k}>
                {tt(`types.${k}`)}
              </option>
            ))}
          </SelectField>
        )}
        {!editing && type === "CASH_REGISTER" && (
          <SelectField label={tt("accountForm.site")} value={siteId} onChange={setSiteId}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        )}
        {(type === "BANK" || type === "MOBILE_MONEY" || type === "OTHER") && (
          <>
            <Input
              label={tt("accountForm.bankName")}
              value={bankName}
              maxLength={80}
              onChange={(e) => setBankName(e.target.value)}
            />
            <Input
              label={tt("accountForm.accountRef")}
              value={accountRef}
              maxLength={60}
              autoComplete="off"
              hint={editing ? tt("accountForm.accountRefKeep") : tt("accountForm.accountRefHint")}
              onChange={(e) => setAccountRef(e.target.value)}
            />
          </>
        )}
        <Input
          label={tt("accountForm.ledgerAccount")}
          value={ledgerAccount}
          inputMode="numeric"
          maxLength={8}
          onChange={(e) => setLedgerAccount(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {type !== "CASH_REGISTER" && type !== "SAFE" && (
        <fieldset className="field">
          <legend className="mb-1 text-[13px] font-semibold">{tt("accountForm.methods")}</legend>
          <p className="mb-2 text-xs text-muted">{tt("accountForm.methodsHint")}</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {ROUTABLE_METHODS.map((m) => {
              const owner = takenMethods[m];
              const taken = Boolean(owner) && owner !== account?.name;
              return (
                <label
                  key={m}
                  className={`flex min-h-11 items-center gap-2 rounded-md px-2 text-sm ${
                    taken ? "text-muted" : "hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={methods.includes(m)}
                    disabled={taken}
                    onChange={() => toggle(m)}
                  />
                  <span>
                    {t(`method.${m}`)}
                    {taken && <span className="block text-xs">→ {owner}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {!editing && (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <MoneyInput
            label={tt("accountForm.openingBalance")}
            value={openingBalance}
            onChange={setOpeningBalance}
          />
          <DateField
            label={tt("accountForm.openingDate")}
            value={openingDate}
            max={todayKey}
            onChange={setOpeningDate}
          />
          <p className="-mt-3 mb-4 text-xs text-muted sm:col-span-2">
            {tt("accountForm.openingHint")}
          </p>
        </div>
      )}
      <ErrorLine message={error} />
    </Modal>
  );
}

// ── Virement ──────────────────────────────────────────────────────────────────────────────

export function TransferModal({
  accounts,
  todayKey,
  defaultFrom,
  onClose,
  onDone,
}: {
  accounts: TreasuryAccount[];
  todayKey: string;
  defaultFrom?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const initialFrom = defaultFrom ?? accounts[0]?.id ?? "";
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(accounts.find((a) => a.id !== initialFrom)?.id ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayKey);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const m = trpc.treasury.transfer.useMutation({
    onSuccess: () => onDone(tt("transferForm.done")),
  });
  const source = accounts.find((a) => a.id === from);
  const overdraft = source?.type === "BANK" && (amount ?? 0) > source.balance;
  return (
    <Modal
      open
      title={tt("transferForm.title")}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Button
            className="min-h-11"
            loading={m.isPending}
            disabled={!amount || !from || !to || from === to}
            onClick={() =>
              amount &&
              m.mutate({
                fromAccountId: from,
                toAccountId: to,
                amount,
                date,
                reference: reference || undefined,
                notes: notes || undefined,
              })
            }
          >
            {tt("actions.transfer")}
          </Button>
        </Footer>
      }
    >
      <SelectField
        label={tt("transferForm.from")}
        value={from}
        onChange={(v) => {
          setFrom(v);
          if (v === to) setTo(accounts.find((a) => a.id !== v)?.id ?? "");
        }}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountOption(a)}
          </option>
        ))}
      </SelectField>
      <SelectField label={tt("transferForm.to")} value={to} onChange={setTo}>
        {accounts
          .filter((a) => a.id !== from)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {accountOption(a)}
            </option>
          ))}
      </SelectField>
      <MoneyInput
        label={tt("transferForm.amount")}
        value={amount}
        onChange={setAmount}
        hint={
          source ? tt("transferForm.available", { amount: formatFCFA(source.balance) }) : undefined
        }
      />
      {overdraft && (
        <p className="-mt-2 mb-4 flex items-center gap-2 text-sm text-status-warn">
          <TriangleAlert size={15} aria-hidden /> {tt("transferForm.overdraft")}
        </p>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DateField label={tt("transferForm.date")} value={date} max={todayKey} onChange={setDate} />
        <Input
          label={tt("transferForm.reference")}
          value={reference}
          maxLength={80}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <Input
        label={tt("transferForm.notes")}
        value={notes}
        maxLength={300}
        onChange={(e) => setNotes(e.target.value)}
      />
      <ErrorLine message={m.error?.message} />
    </Modal>
  );
}

// ── Dépense hors caisse ───────────────────────────────────────────────────────────────────

export function TreasuryExpenseModal({
  accounts,
  categories,
  approval,
  todayKey,
  onClose,
  onDone,
}: {
  accounts: TreasuryAccount[];
  categories: string[];
  approval: number;
  todayKey: string;
  onClose: () => void;
  onDone: (message: string, pending: boolean) => void;
}) {
  const payable = accounts.filter((a) => a.type !== "CASH_REGISTER");
  const [accountId, setAccountId] = useState(
    payable.find((a) => a.type === "BANK")?.id ?? payable[0]?.id ?? "",
  );
  const [category, setCategory] = useState(categories[0] ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayKey);
  const [file, setFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = trpc.treasury.uploadExpenseReceipt.useMutation();
  const m = trpc.treasury.expense.useMutation({
    async onSuccess(expense) {
      if (file) {
        try {
          await upload.mutateAsync({
            expenseId: expense.id,
            mimeType: file.mimeType as "image/webp",
            dataBase64: file.base64,
          });
        } catch {
          // Dépense enregistrée : le justificatif pourra être rajouté.
        }
      }
      const pending = expense.status === "PENDING";
      onDone(pending ? tt("expenseForm.pendingDone") : tt("expenseForm.done"), pending);
    },
  });
  const pending = (amount ?? 0) > approval;
  return (
    <Modal
      open
      title={tt("expenseForm.title")}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Button
            className="min-h-11"
            loading={m.isPending || upload.isPending}
            disabled={!amount || !description.trim() || !accountId}
            onClick={() => amount && m.mutate({ accountId, category, amount, description, date })}
          >
            {tt("save")}
          </Button>
        </Footer>
      }
    >
      <p className="mb-4 text-sm text-muted">{tt("expenseForm.hint")}</p>
      <SelectField label={tt("expenseForm.account")} value={accountId} onChange={setAccountId}>
        {payable.map((a) => (
          <option key={a.id} value={a.id}>
            {accountOption(a)}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField label={tt("expenseForm.category")} value={category} onChange={setCategory}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <MoneyInput label={tt("expenseForm.amount")} value={amount} onChange={setAmount} />
      </div>
      <Input
        label={tt("expenseForm.description")}
        value={description}
        maxLength={300}
        onChange={(e) => setDescription(e.target.value)}
      />
      <DateField label={tt("expenseForm.date")} value={date} max={todayKey} onChange={setDate} />
      <div className="field">
        <span className="text-[13px] font-semibold">{tt("expenseForm.receipt")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => inputRef.current?.click()}
          >
            {file ? <Paperclip size={16} aria-hidden /> : <Camera size={16} aria-hidden />}
            {file ? tt("expenseForm.receiptChange") : tt("expenseForm.receiptTake")}
          </Button>
          {file && <span className="min-w-0 truncate text-sm text-muted">{file.name}</span>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void readReceipt(f).then(setFile);
          }}
        />
      </div>
      <p
        className={`flex items-start gap-2 rounded-md p-3 text-sm ${
          pending ? "bg-status-warn-bg text-status-warn" : "bg-surface-2 text-muted"
        }`}
      >
        <Hourglass size={15} aria-hidden className="mt-0.5 shrink-0" />
        {tt("expenseForm.pendingHint", { amount: formatFCFA(approval) })}
      </p>
      <ErrorLine message={m.error?.message} />
    </Modal>
  );
}

// ── Autre mouvement ───────────────────────────────────────────────────────────────────────

type MovementChoice = "income" | "adjustmentIn" | "adjustmentOut";

export function MovementModal({
  accounts,
  categories,
  todayKey,
  onClose,
  onDone,
}: {
  accounts: TreasuryAccount[];
  categories: { income: string[]; adjustment: string[] };
  todayKey: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [choice, setChoice] = useState<MovementChoice>("income");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const list = choice === "income" ? categories.income : categories.adjustment;
  const [category, setCategory] = useState(list[0] ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(todayKey);
  const [reference, setReference] = useState("");
  const m = trpc.treasury.createMovement.useMutation({
    onSuccess: () => onDone(tt("movementForm.done")),
  });
  const select = (next: MovementChoice) => {
    setChoice(next);
    setCategory((next === "income" ? categories.income : categories.adjustment)[0] ?? "");
  };
  return (
    <Modal
      open
      title={tt("movementForm.title")}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Button
            className="min-h-11"
            loading={m.isPending}
            disabled={!amount || label.trim().length < 3 || !accountId}
            onClick={() =>
              amount &&
              m.mutate({
                accountId,
                kind: choice === "income" ? "INCOME" : "ADJUSTMENT",
                direction: choice === "adjustmentOut" ? "OUT" : "IN",
                amount,
                category,
                label,
                date,
                reference: reference || undefined,
              })
            }
          >
            {tt("save")}
          </Button>
        </Footer>
      }
    >
      <div className="field">
        <span className="text-[13px] font-semibold">{tt("movementForm.kind")}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
          {(["income", "adjustmentIn", "adjustmentOut"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={choice === k}
              onClick={() => select(k)}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 text-sm font-medium ${
                choice === k
                  ? "border-accent bg-accent/10"
                  : "border-border text-muted hover:border-accent"
              }`}
            >
              {k === "adjustmentOut" ? (
                <ArrowUpRight size={15} aria-hidden />
              ) : (
                <ArrowDownLeft size={15} aria-hidden />
              )}
              {tt(`movementForm.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <SelectField label={tt("movementForm.account")} value={accountId} onChange={setAccountId}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountOption(a)}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField label={tt("movementForm.category")} value={category} onChange={setCategory}>
          {list.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <MoneyInput label={tt("movementForm.amount")} value={amount} onChange={setAmount} />
      </div>
      <Input
        label={tt("movementForm.label")}
        placeholder={tt("movementForm.labelPlaceholder")}
        value={label}
        maxLength={200}
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DateField label={tt("movementForm.date")} value={date} max={todayKey} onChange={setDate} />
        <Input
          label={tt("movementForm.reference")}
          value={reference}
          maxLength={80}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <ErrorLine message={m.error?.message} />
    </Modal>
  );
}

// ── Contre-passation ──────────────────────────────────────────────────────────────────────

export function ReverseModal({
  movementId,
  label,
  onClose,
  onDone,
}: {
  movementId: string;
  label: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const m = trpc.treasury.reverseMovement.useMutation({
    onSuccess: () => onDone(tt("reverseForm.done")),
  });
  return (
    <Modal
      open
      title={tt("reverseForm.title")}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <Button
            variant="danger"
            className="min-h-11"
            loading={m.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => m.mutate({ id: movementId, reason })}
          >
            {tt("actions.reverse")}
          </Button>
        </Footer>
      }
    >
      <p className="mb-2 text-sm font-medium">{label}</p>
      <p className="mb-4 text-sm text-muted">{tt("reverseForm.hint")}</p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">{tt("reverseForm.reason")}</span>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
      </label>
      <ErrorLine message={m.error?.message} />
    </Modal>
  );
}

// ── Rapprochement ─────────────────────────────────────────────────────────────────────────

export function ReconcileModal({
  account,
  todayKey,
  onClose,
  onDone,
}: {
  account: TreasuryAccount;
  todayKey: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [date, setDate] = useState(todayKey);
  const [balance, setBalance] = useState<number | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ computedBalance: number; difference: number } | null>(
    null,
  );
  const m = trpc.treasury.reconcile.useMutation({
    onSuccess(r) {
      setResult(r);
      if (r.difference === 0 || adjust) onDone(tt("reconcileForm.done"));
    },
  });
  const needsNote = adjust && !notes.trim();
  // Écart constaté sans ajustement : le rapprochement est enregistré, on ferme.
  const recorded = result !== null && result.difference !== 0 && !adjust;
  return (
    <Modal
      open
      title={`${tt("reconcileForm.title")} — ${account.name}`}
      onClose={onClose}
      footer={
        recorded ? (
          <Button className="min-h-11" onClick={() => onDone(tt("reconcileForm.done"))}>
            {tt("close")}
          </Button>
        ) : (
          <Footer onClose={onClose}>
            <Button
              className="min-h-11"
              loading={m.isPending}
              disabled={balance === null || needsNote}
              onClick={() =>
                balance !== null &&
                m.mutate({
                  accountId: account.id,
                  statementDate: date,
                  statementBalance: balance,
                  notes: notes || undefined,
                  postAdjustment: adjust,
                })
              }
            >
              {tt("actions.reconcile")}
            </Button>
          </Footer>
        )
      }
    >
      <p className="mb-4 text-sm text-muted">{tt("reconcileForm.hint")}</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DateField
          label={tt("reconcileForm.date")}
          value={date}
          max={todayKey}
          onChange={setDate}
        />
        <MoneyInput label={tt("reconcileForm.balance")} value={balance} onChange={setBalance} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} />
        <span>{tt("reconcileForm.adjust")}</span>
      </label>
      {adjust && (
        <label className="mt-2 flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">{tt("reconcileForm.notes")}</span>
          <textarea
            className={`textarea ${needsNote ? "invalid" : ""}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
      )}
      {result && (
        <div
          role="status"
          data-testid="reconcile-result"
          className={`mt-4 flex flex-col gap-1 rounded-md p-3 text-sm ${
            result.difference === 0
              ? "bg-status-ok-bg text-status-ok"
              : "bg-status-warn-bg text-status-warn"
          }`}
        >
          <span className="flex items-center gap-2 font-semibold">
            {result.difference === 0 ? (
              <CircleCheck size={15} aria-hidden />
            ) : (
              <TriangleAlert size={15} aria-hidden />
            )}
            {result.difference === 0
              ? tt("reconcileForm.balanced")
              : `${tt("reconcileForm.difference")} : ${signedFCFA(result.difference)}`}
          </span>
          <span>
            {tt("reconcileForm.computed")} : {formatFCFA(result.computedBalance)}
          </span>
        </div>
      )}
      <ErrorLine message={m.error?.message} />
    </Modal>
  );
}
