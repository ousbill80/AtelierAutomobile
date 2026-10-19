"use client";

// Composants communs des écrans stock / achats (M07) : navigation du module, états
// chargement / erreur, sélecteurs de produit et de site, saisie de motif.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarcodeScanner, Button, Field, Input, Modal, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { qtyText, t } from "./i18n";

export function ErrorBox({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4"
    >
      <p className="text-sm text-status-bad">{message ?? t("common.loadError")}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-status-bad">
      {message}
    </p>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("common.search")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

const STOCK_LINKS = [
  { href: "/stock", key: "catalog", permission: "stock:read" },
  { href: "/stock/sorties", key: "queue", permission: "stock:read" },
  { href: "/stock/mouvements", key: "movements", permission: "stock:read" },
  { href: "/stock/inventaires", key: "counts", permission: "stock:count" },
  { href: "/stock/transferts", key: "transfers", permission: "stock:transfer" },
  { href: "/stock/valorisation", key: "valuation", permission: "stock:valuation" },
];
const PURCHASE_LINKS = [
  { href: "/achats", key: "purchases", permission: "purchase:read" },
  { href: "/achats/suggestions", key: "suggestions", permission: "purchase:create" },
  { href: "/achats/fournisseurs", key: "suppliers", permission: "purchase:read" },
];

export function useMe() {
  return trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
}

export function useCan(): (permission: string) => boolean {
  const me = useMe();
  const set = new Set<string>(me.data?.permissions ?? []);
  return (permission) => set.has(permission);
}

/** Sous-navigation du module (onglets défilants sur mobile). */
export function ModuleNav({ section }: { section: "stock" | "purchases" }) {
  const pathname = usePathname();
  const can = useCan();
  const links = (section === "stock" ? STOCK_LINKS : PURCHASE_LINKS).filter((l) =>
    can(l.permission),
  );
  const active = [...links]
    .sort((a, b) => b.href.length - a.href.length)
    .find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
  return (
    <nav
      className="-mx-1 flex gap-1 overflow-x-auto pb-1"
      aria-label={t(`nav.${section === "stock" ? "catalog" : "purchases"}`)}
    >
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active?.href === l.href ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm ${
            active?.href === l.href
              ? "bg-accent text-accent-foreground font-medium"
              : "bg-surface-2"
          }`}
        >
          {t(`nav.${l.key}`)}
        </Link>
      ))}
    </nav>
  );
}

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Sélecteur de site (sites autorisés), avec option « Tous les sites » facultative. */
export function SiteSelect({
  value,
  onChange,
  allowAll = false,
  label = t("common.site"),
  id,
}: {
  value: string;
  onChange: (siteId: string) => void;
  allowAll?: boolean;
  label?: string;
  id?: string;
}) {
  const me = useMe();
  const sites = me.data?.allowedSites ?? [];
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll ? <option value="">{t("common.allSites")}</option> : null}
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Site par défaut : site actif de la session, sinon le premier site autorisé. */
export function useDefaultSite(): [string, (id: string) => void] {
  const me = useMe();
  const [chosen, setChosen] = useState("");
  const siteId = chosen || me.data?.activeSiteId || me.data?.allowedSites[0]?.id || "";
  return [siteId, setChosen];
}

export interface PickedProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantityScale: number;
  purchasePrice: number | null;
  averageCost: number | null;
  levels: { siteId: string; siteCode: string; available: number; onHand: number }[];
}

/** Recherche d'un produit (texte, code-barres, scan) avec liste de résultats. */
export function ProductPicker({
  onPick,
  label = t("common.product"),
  placeholder = t("catalog.searchPlaceholder"),
  autoFocus,
}: {
  onPick: (product: PickedProduct) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const search = trpc.product.search.useQuery(
    { q: q.trim() || undefined, limit: 8 },
    { enabled: q.trim().length >= 2 },
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={label}>
            <Input
              value={q}
              placeholder={placeholder}
              autoFocus={autoFocus}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
        </div>
        <Button type="button" variant="secondary" onClick={() => setScanOpen(true)}>
          {t("common.scan")}
        </Button>
      </div>
      {q.trim().length >= 2 && search.data ? (
        <ul className="flex max-h-60 flex-col overflow-y-auto rounded-md border border-border bg-surface">
          {search.data.items.length === 0 ? (
            <li className="p-3 text-sm text-muted">{t("catalog.empty")}</li>
          ) : (
            search.data.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    onPick(p);
                    setQ("");
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    {p.sku}
                    {" · "}
                    {p.levels
                      .map((l) => `${l.siteCode} ${qtyText(l.available, p.quantityScale)}`)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(code) => {
          setScanOpen(false);
          setQ(code);
        }}
        labels={scannerLabels()}
      />
    </div>
  );
}

export function scannerLabels() {
  return {
    title: t("scanner.title"),
    manualLabel: t("scanner.manualLabel"),
    manualSubmit: t("scanner.manualSubmit"),
    permissionDenied: t("scanner.permissionDenied"),
    unsupported: t("scanner.unsupported"),
    starting: t("scanner.starting"),
  };
}

/** Modale de saisie d'un motif obligatoire (libérer, solder, annuler…). */
export function ReasonModal({
  open,
  title,
  submitLabel,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={reason.trim().length < 3 || pending}
            onClick={() => onSubmit(reason.trim())}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("common.reason")}>
          <Textarea
            value={reason}
            placeholder={t("common.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

/** Téléchargement d'un contenu texte (CSV) côté navigateur. */
export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
