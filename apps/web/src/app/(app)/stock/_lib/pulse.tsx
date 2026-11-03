"use client";

// Pilotage magasin : ce que le garage a, ce qui manque, ce qu'il faut commander ou réceptionner.
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { EduTip } from "@/components/edu-tip";
import { LinkButton } from "@/components/link-button";
import { t } from "./i18n";
import { useCan } from "./components";

type Tone = "neutral" | "warn" | "bad";

function toneClass(tone: Tone, value: number): string {
  if (value <= 0 || tone === "neutral") return "text-foreground";
  return tone === "bad" ? "text-status-bad" : "text-status-warn";
}

function PulseCard({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  onClick,
  help,
  example,
  compact = false,
  pressed = false,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: Tone;
  href?: string;
  onClick?: () => void;
  help: string;
  example: string;
  compact?: boolean;
  pressed?: boolean;
}) {
  const numeric = Number(value.replace(/[^\d-]/g, "")) || 0;
  const toneName = toneClass(tone, numeric);
  const interactive = Boolean(href || onClick);
  const className = compact
    ? `mini-stat w-full pr-10${pressed ? " is-pressed" : ""}${interactive ? "" : " is-static"}`
    : `flex min-h-24 min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4 pr-12 text-left${interactive ? " transition-colors hover:border-accent/40 hover:bg-surface-2" : ""}`;
  const body = compact ? (
    <span className="min-w-0">
      <span
        className={`mini-stat-value whitespace-nowrap ${toneName === "text-status-bad" ? "bad" : toneName === "text-status-warn" ? "warn" : ""}`}
      >
        {value}
      </span>
      <span className="mini-stat-label">{label}</span>
    </span>
  ) : (
    <>
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${toneName}`}>{value}</span>
      <span className="text-xs text-muted">{sub}</span>
    </>
  );
  const card = href ? (
    <Link href={href} className={className} aria-label={`${label}, ${value}. ${sub}`}>
      {body}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-pressed={pressed}
      aria-label={`${label}, ${value}. ${sub}`}
    >
      {body}
    </button>
  ) : (
    <div className={className} aria-label={`${label}, ${value}. ${sub}`}>
      {body}
    </div>
  );
  return (
    <div className="relative min-w-0">
      {card}
      <span className="absolute right-0.5 top-0.5 z-10">
        <EduTip text={help} example={example} />
      </span>
    </div>
  );
}

export function GaragePulse({
  focus,
  siteId,
  onStockFilter,
  onPurchaseView,
  purchaseView,
  activeStockFilter,
}: {
  focus: "stock" | "purchases";
  siteId?: string;
  onStockFilter?: (filter: "belowMin" | "negative") => void;
  onPurchaseView?: (view: "drafts" | "late") => void;
  purchaseView?: "drafts" | "late";
  activeStockFilter?: "belowMin" | "negative";
}) {
  const pulse = trpc.stock.pulse.useQuery({ siteId });
  if (pulse.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    );
  }
  if (pulse.isError || !pulse.data) return null;
  const data = pulse.data;

  if (focus === "purchases") {
    return (
      <div className="mini-stats cols-5">
        <PulseCard
          compact
          label={t("pulse.drafts")}
          value={String(data.drafts)}
          sub={t("pulse.draftsSub")}
          tone="warn"
          pressed={purchaseView === "drafts"}
          help={t("pulse.help.drafts")}
          example={t("pulse.example.drafts")}
          onClick={onPurchaseView ? () => onPurchaseView("drafts") : undefined}
        />
        <PulseCard
          compact
          label={t("pulse.toReceive")}
          value={String(data.toReceive)}
          sub={t("pulse.toReceiveSub")}
          tone="warn"
          help={t("pulse.help.toReceive")}
          example={t("pulse.example.toReceive")}
        />
        <PulseCard
          compact
          label={t("pulse.late")}
          value={String(data.late)}
          sub={t("pulse.lateSub")}
          tone="bad"
          pressed={purchaseView === "late"}
          help={t("pulse.help.late")}
          example={t("pulse.example.late")}
          onClick={onPurchaseView ? () => onPurchaseView("late") : undefined}
        />
        <PulseCard
          compact
          label={t("pulse.reorder")}
          value={String(data.belowMin)}
          sub={t("pulse.reorderSub")}
          tone="warn"
          help={t("pulse.help.reorder")}
          example={t("pulse.example.reorder")}
          href="/achats/suggestions"
        />
        <PulseCard
          compact
          label={t("pulse.backorders")}
          value={String(data.backorders)}
          sub={t("pulse.backordersSub")}
          tone="bad"
          help={t("pulse.help.backorders")}
          example={t("pulse.example.backorders")}
          href="/atelier/pieces"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <PulseCard
        compact
        label={t("pulse.products")}
        value={String(data.products)}
        sub={t("pulse.productsSub")}
        help={t("pulse.help.products")}
        example={t("pulse.example.products")}
      />
      <PulseCard
        compact
        label={t("pulse.belowMin")}
        value={String(data.belowMin)}
        sub={t("pulse.belowMinSub")}
        tone="warn"
        pressed={activeStockFilter === "belowMin"}
        help={t("pulse.help.belowMin")}
        example={t("pulse.example.belowMin")}
        onClick={onStockFilter ? () => onStockFilter("belowMin") : undefined}
      />
      <PulseCard
        compact
        label={t("pulse.outOfStock")}
        value={String(data.outOfStock)}
        sub={t("pulse.outOfStockSub")}
        tone="bad"
        help={t("pulse.help.outOfStock")}
        example={t("pulse.example.outOfStock")}
      />
      <PulseCard
        compact
        label={t("pulse.negative")}
        value={String(data.negative)}
        sub={t("pulse.negativeSub")}
        tone="bad"
        pressed={activeStockFilter === "negative"}
        help={t("pulse.help.negative")}
        example={t("pulse.example.negative")}
        onClick={onStockFilter ? () => onStockFilter("negative") : undefined}
      />
      <PulseCard
        compact
        label={t("pulse.partRequests")}
        value={String(data.openPartRequests)}
        sub={t("pulse.partRequestsSub")}
        tone="warn"
        help={t("pulse.help.partRequests")}
        example={t("pulse.example.partRequests")}
        href="/atelier/pieces"
      />
      {data.stockValue != null ? (
        <PulseCard
          compact
          label={t("pulse.value")}
          value={formatFCFA(data.stockValue)}
          sub={t("pulse.valueSub")}
          help={t("pulse.help.value")}
          example={t("pulse.example.value")}
          href="/stock/valorisation"
        />
      ) : null}
    </div>
  );
}

/** Bouton du catalogue de démarrage, affiché quand le magasin n'a encore aucune pièce. */
export function StarterCatalogAction({ onDone }: { onDone: (created: number) => void }) {
  const can = useCan();
  const utils = trpc.useUtils();
  const install = trpc.product.installStarterCatalog.useMutation({
    onSuccess(result) {
      void utils.product.invalidate();
      void utils.stock.pulse.invalidate();
      void utils.purchaseOrder.suggestions.invalidate();
      onDone(result.created);
    },
  });
  if (!can("product:manage")) {
    return <p className="text-sm text-muted">{t("starter.noPermission")}</p>;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button loading={install.isPending} onClick={() => install.mutate()}>
        {t("starter.action")}
      </Button>
      {install.isError ? (
        <p role="alert" className="text-sm text-status-bad">
          {install.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Action de l'état vide des achats : catalogue d'abord, sinon les suggestions. */
export function PurchasesEmptyAction() {
  const pulse = trpc.stock.pulse.useQuery({});
  if (pulse.data?.products === 0) return <StarterCatalogHint />;
  return (
    <LinkButton href="/achats/suggestions" variant="secondary" size="sm">
      {t("nav.suggestions")}
    </LinkButton>
  );
}

export function StarterCatalogHint() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted">{t("starter.goToStock")}</p>
      <LinkButton href="/stock" variant="secondary" size="sm">
        {t("starter.openStock")}
      </LinkButton>
    </div>
  );
}
