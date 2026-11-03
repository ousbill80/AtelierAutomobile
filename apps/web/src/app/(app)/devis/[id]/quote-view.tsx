"use client";

// M05 §7 — fiche devis : éditeur (brouillon) et consultation (envoyé / décidé). En-tête et
// bandeau d'état, barre d'actions, groupes de lignes (catalogue MO / pièces / kits, remises,
// payeur, optionnel, priorité, explication client), totaux, frise, versions et écarts.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Send, Sparkles, Trash2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  CheckboxRow,
  Input,
  Modal,
  MoneyInput,
  PlateBadge,
  Select,
  Tabs,
  Textarea,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { trpc } from "@/trpc/react";
import { PortalLinksPanel } from "@/components/portal/portal-links-panel";
import { QuoteExplanationPanel } from "@/components/ai-quotes/quote-explanation-panel";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { QuoteStatusBadge } from "@/components/quotes/badges";
import { t } from "@/components/quotes/i18n";
import { DecisionModal, DiscountModal, SendModal } from "./modals";

export type QuoteDetail = inferRouterOutputs<AppRouter>["quote"]["get"];
type Line = QuoteDetail["lines"][number];
type Flash = { tone: "ok" | "bad"; text: string } | null;

const DECIDED = new Set(["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"]);

export function QuoteView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const query = trpc.quote.get.useQuery({ id });
  const [flash, setFlash] = useState<Flash>(null);
  const [tab, setTab] = useState<"timeline" | "versions" | "reminders">("timeline");
  const [explainOpen, setExplainOpen] = useState(false);
  const refresh = () => {
    void utils.quote.get.invalidate({ id });
    void utils.quote.list.invalidate();
  };
  const onError = (e: { message: string }) => setFlash({ tone: "bad", text: e.message });

  if (query.isLoading) return <ListSkeleton rows={4} />;
  if (query.isError || !query.data) {
    return (
      <ErrorBox
        message={query.error?.data?.code === "NOT_FOUND" ? t("notFound") : undefined}
        onRetry={() => query.refetch()}
      />
    );
  }
  const quote = query.data;
  const perms = new Set(me.data?.permissions ?? []);
  const editable = quote.status === "DRAFT" && !quote.supersededAt && perms.has("quote:update");
  const canExplain =
    quote.lines.length > 0 &&
    !quote.supersededAt &&
    perms.has("ai:use") &&
    perms.has("quote:create") &&
    perms.has("quote:update");

  return (
    <div className="flex min-w-0 flex-col gap-3 pb-16">
      <Link href="/devis" className="inline-flex min-h-11 items-center gap-1 text-sm text-accent">
        <ArrowLeft size={16} aria-hidden /> {t("back")}
      </Link>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-3 border-b border-border px-5 pb-6 pt-5">
          <Header quote={quote} />
          <Banners quote={quote} perms={perms} onDone={refresh} onError={onError} />
          {flash && (
            <p
              role={flash.tone === "bad" ? "alert" : "status"}
              className={`rounded-md p-2 text-sm ${flash.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-ok-bg text-status-ok"}`}
            >
              {flash.text}
            </p>
          )}
          <ActionBar
            quote={quote}
            perms={perms}
            onDone={(text) => {
              setFlash(text ? { tone: "ok", text } : null);
              refresh();
            }}
            onError={onError}
          />
          {quote.alreadyApproved.length > 0 && (
            <p className="rounded-md bg-surface-2 p-2 text-sm">
              ✓ {t("alreadyApproved")} :{" "}
              {quote.alreadyApproved.map((l) => l.description).join(", ")}
            </p>
          )}
        </div>
        <div className="grid items-start lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-4 px-5 pb-5 pt-6 lg:border-r lg:border-border">
            <Lines
              quote={quote}
              editable={editable}
              canExplain={canExplain}
              explainOpen={explainOpen}
              onToggleExplain={() => setExplainOpen((open) => !open)}
              onDone={refresh}
              onError={onError}
            />
            {explainOpen && (
              <QuoteExplanationPanel
                quoteId={quote.id}
                validated={(quote.customerExplanation ?? null) as Record<string, string> | null}
                canGenerate={canExplain}
                onSaved={refresh}
              />
            )}
            <div className="max-w-full overflow-x-auto border-t border-border pt-2">
              <Tabs
                items={(["timeline", "versions", "reminders"] as const).map((key) => ({
                  key,
                  label: t(`tabs.${key}`),
                }))}
                activeKey={tab}
                onChange={(key) => setTab(key as typeof tab)}
              />
            </div>
            {tab === "timeline" && quote.status !== "DRAFT" && (
              <PortalLinksPanel
                scope="QUOTE"
                targetId={quote.id}
                canWrite={perms.has("quote:send")}
              />
            )}
            {tab === "timeline" && <Timeline quote={quote} />}
            {tab === "versions" && <Versions quote={quote} />}
            {tab === "reminders" && <Reminders quote={quote} />}
          </div>
          <aside className="flex flex-col gap-3 border-t border-border bg-surface-2 px-5 pb-5 pt-6 lg:border-t-0">
            <Totals quote={quote} editable={editable} onDone={refresh} onError={onError} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Header({ quote }: { quote: QuoteDetail }) {
  return (
    <header className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-lg font-semibold">{quote.number}</h1>
        <span className="text-muted">{t("versionShort", { version: quote.version })}</span>
        <QuoteStatusBadge status={quote.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/clients/${quote.customer.id}`} className="font-semibold text-accent">
          {quote.customer.displayName}
        </Link>
        {quote.vehicle && (
          <>
            <PlateBadge plate={quote.vehicle.plate} />
            <span>
              {quote.vehicle.make} {quote.vehicle.model}
            </span>
          </>
        )}
        {quote.repairOrder && (
          <Link href={`/ordres/${quote.repairOrder.id}`} className="text-accent">
            {quote.repairOrder.number}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>{t(`origin.${quote.origin}`)}</span>
        {quote.createdByName && <span>{t("advisor", { name: quote.createdByName })}</span>}
        {quote.viewedAt && (
          <span>👁 {t("viewedAt", { date: formatDateTime(quote.viewedAt, quote.timeZone) })}</span>
        )}
      </div>
    </header>
  );
}

function Banners({
  quote,
  perms,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  perms: Set<string>;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const current = quote.versions.at(-1);
  return (
    <>
      {quote.supersededAt && current && current.id !== quote.id && (
        <p className="rounded-md bg-surface-2 p-2 text-sm">
          {t("banner.superseded", { version: current.version })}{" "}
          <Link href={`/devis/${current.id}`} className="text-accent">
            {t("banner.openCurrent")}
          </Link>
        </p>
      )}
      {quote.discountApprovalStatus === "PENDING" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warn bg-status-warn-bg p-2 text-sm text-status-warn">
          <span>⚠ {t("discount.pending")}</span>
          {perms.has("quote:discount_override") && (
            <Button size="sm" className="min-h-11" onClick={() => setDiscountOpen(true)}>
              {t("discount.review")}
            </Button>
          )}
        </div>
      )}
      {quote.discountApprovalStatus === "REJECTED" && (
        <p className="rounded-md bg-status-bad-bg p-2 text-sm text-status-bad">
          ✕ {t("discount.rejected")}
        </p>
      )}
      {quote.expired && (quote.status === "SENT" || quote.status === "VIEWED") && (
        <p className="rounded-md bg-status-bad-bg p-2 text-sm text-status-bad">
          ⏰ {t("banner.pastValidity")}
        </p>
      )}
      {quote.decidedAt && (
        <p className="rounded-md bg-surface-2 p-2 text-sm">
          {t("banner.decided", {
            date: formatDateTime(quote.decidedAt, quote.timeZone),
            channel: t(`channels.${quote.decisionChannel ?? "portal"}`),
          })}
          {quote.signerName ? ` — ${t("banner.signer", { name: quote.signerName })}` : ""}
          {quote.decisionHash
            ? ` (${t("banner.hash", { hash: quote.decisionHash.slice(0, 8) })})`
            : ""}
        </p>
      )}
      <DiscountModal
        open={discountOpen}
        quote={quote}
        onClose={() => setDiscountOpen(false)}
        onDone={() => {
          setDiscountOpen(false);
          onDone();
        }}
        onError={onError}
      />
    </>
  );
}

function ActionBar({
  quote,
  perms,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  perms: Set<string>;
  onDone: (text?: string) => void;
  onError: (e: { message: string }) => void;
}) {
  const router = useRouter();
  const [sendOpen, setSendOpen] = useState(false);
  const [decision, setDecision] = useState<null | { amendment: boolean }>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const current = !quote.supersededAt;
  const awaiting = quote.status === "SENT" || quote.status === "VIEWED";
  const accepted = quote.status === "ACCEPTED" || quote.status === "PARTIALLY_ACCEPTED";

  const version = trpc.quote.createVersion.useMutation({
    onSuccess: (res) => router.push(`/devis/${res.id}`),
    onError,
  });
  const resend = trpc.quote.resend.useMutation({
    onSuccess: () => onDone(t("flash.resent")),
    onError,
  });
  const followUp = trpc.quote.followUpNow.useMutation({
    onSuccess: () => onDone(t("flash.followedUp")),
    onError,
  });
  const regenerate = trpc.quote.regenerateLink.useMutation({
    onSuccess: (res) => {
      setLink(res.publicUrl);
      onDone(t("flash.linkRegenerated"));
    },
    onError,
  });
  const toOrder = trpc.quote.convertToRepairOrder.useMutation({
    onSuccess: (res) => router.push(`/ordres/${res.repairOrderId}`),
    onError,
  });
  const toInvoice = trpc.quote.convertToInvoice.useMutation({
    onSuccess: () => onDone(t("flash.invoiced")),
    onError,
  });
  const deposit = trpc.quote.requestDeposit.useMutation({
    onSuccess: () => onDone(t("flash.depositRequested")),
    onError,
  });
  const remove = trpc.quote.delete.useMutation({
    onSuccess: () => router.push("/devis"),
    onError,
  });

  const buttons: ReactNode[] = [];
  const add = (key: string, node: ReactNode, order = 50) =>
    buttons.push(
      <span key={key} style={{ order }}>
        {node}
      </span>,
    );
  if (current && quote.status === "DRAFT" && perms.has("quote:send")) {
    add(
      "send",
      <Button
        className="min-h-11"
        disabled={quote.sendBlockers.length > 0}
        onClick={() => setSendOpen(true)}
      >
        <Send size={16} aria-hidden /> {t("actions.sendToCustomer")}
      </Button>,
      40,
    );
  }
  if (current && (quote.status === "DRAFT" || awaiting) && perms.has("quote:record_decision")) {
    add(
      "decide",
      <Button
        variant="secondary"
        className="min-h-11"
        onClick={() => setDecision({ amendment: false })}
      >
        {t("actions.recordDecision")}
      </Button>,
      30,
    );
  }
  if (current && awaiting && perms.has("quote:send")) {
    add(
      "resend",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={resend.isPending}
        onClick={() => resend.mutate({ id: quote.id })}
      >
        {t("actions.resend")}
      </Button>,
    );
    add(
      "followup",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={followUp.isPending}
        onClick={() => followUp.mutate({ id: quote.id })}
      >
        {t("actions.followUpNow")}
      </Button>,
    );
    add(
      "regen",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={regenerate.isPending}
        onClick={() => regenerate.mutate({ id: quote.id })}
      >
        {t("actions.regenerateLink")}
      </Button>,
    );
  }
  if (current && (awaiting || quote.status === "EXPIRED") && perms.has("quote:update")) {
    add(
      "version",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={version.isPending}
        onClick={() => version.mutate({ id: quote.id })}
      >
        {quote.status === "EXPIRED" ? t("actions.reactivate") : t("actions.edit")}
      </Button>,
    );
  }
  if (
    current &&
    accepted &&
    perms.has("quote:record_decision") &&
    quote.lines.some((l) => l.accepted === false)
  ) {
    add(
      "amend",
      <Button
        variant="secondary"
        className="min-h-11"
        onClick={() => setDecision({ amendment: true })}
      >
        {t("actions.amend")}
      </Button>,
    );
  }
  if (current && accepted && !quote.repairOrderId && perms.has("quote:update")) {
    if (quote.vehicle && perms.has("repair_order:create")) {
      add(
        "toOrder",
        <Button
          className="min-h-11"
          loading={toOrder.isPending}
          onClick={() => toOrder.mutate({ id: quote.id })}
        >
          {t("actions.convertToOrder")}
        </Button>,
      );
    }
    add(
      "toInvoice",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={toInvoice.isPending}
        onClick={() => toInvoice.mutate({ id: quote.id })}
      >
        {t("actions.convertToInvoice")}
      </Button>,
    );
  }
  if (
    (accepted || quote.status === "CONVERTED") &&
    quote.depositAmount &&
    !quote.depositInvoiceId &&
    perms.has("quote:update")
  ) {
    add(
      "deposit",
      <Button
        variant="secondary"
        className="min-h-11"
        loading={deposit.isPending}
        onClick={() => deposit.mutate({ id: quote.id })}
      >
        {t("actions.requestDeposit", { amount: formatFCFA(quote.depositAmount) })}
      </Button>,
    );
  }
  add(
    "pdf",
    <a
      className="btn btn-secondary min-h-11"
      href={`/api/devis/${quote.id}/pdf?variant=${DECIDED.has(quote.status) ? "signed" : "customer"}`}
      target="_blank"
      rel="noreferrer"
    >
      {t("actions.previewPdf")}
    </a>,
    20,
  );
  if (quote.insuranceClaimId) {
    add(
      "pdfInsurer",
      <a
        className="btn btn-secondary min-h-11"
        href={`/api/devis/${quote.id}/pdf?variant=insurer`}
        target="_blank"
        rel="noreferrer"
      >
        {t("actions.insurerPdf")}
      </a>,
      25,
    );
  }
  if (current && quote.status === "DRAFT" && !quote.sentAt && perms.has("quote:delete")) {
    add(
      "delete",
      <Button variant="danger" className="min-h-11" onClick={() => setDeleteOpen(true)}>
        {t("actions.deleteShort")}
      </Button>,
      10,
    );
  }

  return (
    <section className="flex flex-col gap-2">
      {quote.status === "DRAFT" && current && quote.sendBlockers.length > 0 && (
        <ul className="text-xs text-status-warn">
          {quote.sendBlockers.map((b) => (
            <li key={b}>⚠ {b}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {link && (
        <p className="break-all rounded-md bg-surface-2 p-2 text-xs">
          {t("send.link")} : {link}
        </p>
      )}
      <SendModal
        open={sendOpen}
        quote={quote}
        onClose={() => setSendOpen(false)}
        onDone={(text) => {
          setSendOpen(false);
          onDone(text);
        }}
      />
      {decision && (
        <DecisionModal
          quote={quote}
          amendment={decision.amendment}
          onClose={() => setDecision(null)}
          onDone={(text) => {
            setDecision(null);
            onDone(text);
          }}
        />
      )}
      <Modal
        open={deleteOpen}
        title={t("actions.delete")}
        onClose={() => setDeleteOpen(false)}
        footer={
          <Button
            disabled={reason.trim().length < 3}
            loading={remove.isPending}
            onClick={() => remove.mutate({ id: quote.id, reason })}
          >
            {t("actions.confirmDelete")}
          </Button>
        }
      >
        <Input
          label={t("fields.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </section>
  );
}

// ───────────── Lignes ─────────────

const LINE_GRID =
  "grid grid-cols-[minmax(6rem,1.4fr)_11.5rem_3.25rem_8.25rem_3.25rem_6.5rem_6.75rem_2.75rem] items-center gap-x-1";

function Lines({
  quote,
  editable,
  canExplain,
  explainOpen,
  onToggleExplain,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  editable: boolean;
  canExplain: boolean;
  explainOpen: boolean;
  onToggleExplain: () => void;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [groupName, setGroupName] = useState("");
  const [showGroup, setShowGroup] = useState(false);
  const byId = new Map(quote.lines.map((l) => [l.id, l]));
  const count = quote.lines.length;
  return (
    <section className="flex flex-col gap-2" aria-label={t("lines.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("lines.title")}
          <span className="font-normal text-muted">
            {" "}
            · {t(count > 1 ? "lines.countPlural" : "lines.count", { count })}
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-pressed={showGroup}
              onClick={() => setShowGroup((open) => !open)}
            >
              {t("lines.groupShort")}
            </Button>
          )}
          {canExplain && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              aria-pressed={explainOpen}
              onClick={onToggleExplain}
            >
              <Sparkles size={16} aria-hidden /> {t("lines.explainAi")}
            </Button>
          )}
        </div>
      </div>
      {count === 0 && <p className="text-sm text-muted">{t("lines.empty")}</p>}
      {(count > 0 || editable) && (
        <div className="overflow-x-auto">
          <div>
            <div
              className={`${LINE_GRID} mb-3 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted`}
            >
              <span>{t("lines.columns.description")}</span>
              <span>{t("lines.columns.category")}</span>
              <span>{t("lines.columns.qty")}</span>
              <span>{t("lines.columns.unit")}</span>
              <span>{t("lines.columns.discount")}</span>
              <span>{t("lines.columns.payer")}</span>
              <span className="text-right">{t("lines.columns.total")}</span>
              <span />
            </div>
            {quote.groups.map((group) => (
              <article key={group.key} aria-label={group.label}>
                {group.lineIds.length > 1 && (
                  <p className="border-t border-border px-1 pt-2 text-xs font-semibold text-muted">
                    {group.label}
                  </p>
                )}
                {group.lineIds.map((id) => {
                  const line = byId.get(id);
                  if (!line) return null;
                  return (
                    <LineTableRow
                      key={line.id}
                      quote={quote}
                      line={line}
                      editable={editable}
                      onDone={onDone}
                      onError={onError}
                    />
                  );
                })}
              </article>
            ))}
          </div>
        </div>
      )}
      {editable && (
        <AddLine
          quote={quote}
          group={groupName}
          onGroupChange={setGroupName}
          showGroup={showGroup}
          onDone={onDone}
          onError={onError}
        />
      )}
    </section>
  );
}

function LineTableRow({
  quote,
  line,
  editable,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  line: Line;
  editable: boolean;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const update = trpc.quoteLine.update.useMutation({ onSuccess: onDone, onError });
  const remove = trpc.quoteLine.remove.useMutation({ onSuccess: onDone, onError });
  const [explain, setExplain] = useState(Boolean(line.customerExplanation));
  // HT after line and global discounts, before VAT — sums to the recap "Total HT".
  const totalHt = line.amounts.billable ? line.amounts.subtotal : null;
  const total = totalHt != null ? formatFCFA(totalHt) : t("lines.coveredByGarage");
  return (
    <div className="border-t border-border">
      <div className={`${LINE_GRID} px-1 py-2`}>
        <div className="min-w-0">
          <div className="font-medium leading-snug">{line.description}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-accent">{t(`lineTypes.${line.type}`)}</span>
            {editable ? (
              <CheckboxRow
                label={t("lines.optional")}
                checked={line.isOptional}
                onChange={(e) =>
                  update.mutate({ id: line.id, patch: { isOptional: e.target.checked } })
                }
              />
            ) : (
              line.isOptional && <span className="text-muted">({t("lines.optional")})</span>
            )}
            {editable && (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-accent"
                onClick={() => setExplain((open) => !open)}
              >
                + {t("lines.explain")}
              </button>
            )}
            {line.accepted === true && (
              <span className="text-status-ok">✓ {t("lines.accepted")}</span>
            )}
            {line.accepted === false && (
              <span className="text-status-bad">✕ {t("lines.declined")}</span>
            )}
          </div>
          {(line.available != null ||
            line.overCap ||
            line.costPrice != null ||
            line.declineReason) && (
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
              {line.available != null && (
                <span className={line.available > 0 ? "text-status-ok" : "text-status-warn"}>
                  {line.available > 0
                    ? t("lines.inStock", { count: line.available })
                    : t("lines.toOrder", { days: 3 })}
                </span>
              )}
              {line.overCap && (
                <span className="text-status-warn">
                  ⚠ {t("discount.overCap", { cap: quote.discount.cap.line })}
                </span>
              )}
              {line.costPrice != null && (
                <span>{t("lines.cost", { amount: formatFCFA(line.costPrice) })}</span>
              )}
              {line.accepted === false && line.declineReason && (
                <span>— {t(`declineReasons.${line.declineReason}`)}</span>
              )}
            </div>
          )}
        </div>
        {editable ? (
          <Select
            aria-label={t("fields.priority")}
            value={line.priority ?? ""}
            className="select-compact"
            onChange={(e) => {
              const priority = e.target.value;
              update.mutate({
                id: line.id,
                patch: {
                  priority: priority === "URGENT" || priority === "WATCH" ? priority : null,
                },
              });
            }}
          >
            <option value="">{t("priority.OTHER")}</option>
            <option value="URGENT">{t("priority.URGENT")}</option>
            <option value="WATCH">{t("priority.WATCH")}</option>
          </Select>
        ) : (
          <span className="text-sm">{t(`priority.${line.priority ?? "OTHER"}`)}</span>
        )}
        {editable ? (
          <Input
            aria-label={line.type === "LABOR" ? t("fields.hours") : t("fields.quantity")}
            type="number"
            inputMode="decimal"
            step={line.type === "LABOR" ? 0.25 : 1}
            className="input-compact"
            defaultValue={line.quantity}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v > 0 && v !== line.quantity)
                update.mutate({ id: line.id, patch: { quantity: v } });
            }}
          />
        ) : (
          <span className="text-sm">
            {line.quantity.toLocaleString("fr-FR")}
            {line.type === "LABOR" ? " h" : ""}
          </span>
        )}
        {editable ? (
          <MoneyInput
            aria-label={t("fields.unitPrice")}
            value={line.unitPrice}
            onChange={(v) => {
              if (v != null && v !== line.unitPrice)
                update.mutate({ id: line.id, patch: { unitPrice: v } });
            }}
          />
        ) : (
          <span className="text-sm">{formatFCFA(line.unitPrice)}</span>
        )}
        {editable ? (
          <Input
            aria-label={t("fields.discountRate")}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            className="input-compact"
            invalid={line.overCap}
            defaultValue={line.discountRate}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 0 && v <= 100 && v !== line.discountRate) {
                update.mutate({ id: line.id, patch: { discountRate: v } });
              }
            }}
          />
        ) : (
          <span className="text-sm">{line.discountRate}</span>
        )}
        {editable ? (
          <Select
            aria-label={t("fields.payer")}
            value={line.payer}
            className="select-compact"
            onChange={(e) =>
              update.mutate({ id: line.id, patch: { payer: e.target.value as "CUSTOMER" } })
            }
          >
            {["CUSTOMER", "INSURANCE", "WARRANTY", "INTERNAL"].map((payer) => (
              <option key={payer} value={payer}>
                {t(`payers.${payer}`)}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-sm">{t(`payers.${line.payer}`)}</span>
        )}
        <span className="text-right text-sm font-semibold">{total}</span>
        {editable ? (
          <Button
            variant="ghost"
            iconOnly
            className="min-h-11 min-w-11 text-status-bad"
            aria-label={t("lines.remove", { label: line.description })}
            loading={remove.isPending}
            onClick={() => remove.mutate({ id: line.id })}
          >
            <Trash2 size={16} />
          </Button>
        ) : (
          <span />
        )}
      </div>
      {editable && explain && (
        <div className="px-1 pb-2">
          <Textarea
            aria-label={t("fields.explanation")}
            placeholder={t("fields.explanationPlaceholder")}
            defaultValue={line.customerExplanation ?? ""}
            rows={2}
            onBlur={(e) => {
              if ((line.customerExplanation ?? "") !== e.target.value) {
                update.mutate({
                  id: line.id,
                  patch: { customerExplanation: e.target.value || null },
                });
              }
            }}
          />
        </div>
      )}
      {!editable && line.customerExplanation && (
        <p className="px-1 pb-2 text-sm text-muted">{line.customerExplanation}</p>
      )}
    </div>
  );
}

function AddLine({
  quote,
  group,
  onGroupChange,
  showGroup,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  group: string;
  onGroupChange: (value: string) => void;
  showGroup: boolean;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"catalog" | "free">("catalog");
  const [type, setType] = useState<"LABOR" | "PART" | "SUBCONTRACT" | "FEE">("PART");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const catalog = trpc.quote.catalog.useQuery(
    { q: q.trim(), quoteId: quote.id },
    { enabled: mode === "catalog" && q.trim().length >= 2 },
  );
  const add = trpc.quoteLine.add.useMutation({
    onSuccess: () => {
      setQ("");
      setDescription("");
      setUnitPrice(null);
      onDone();
    },
    onError,
  });
  const addKit = trpc.quote.addKit.useMutation({
    onSuccess: () => {
      setQ("");
      onDone();
    },
    onError,
  });
  const groupFields =
    showGroup && group.trim()
      ? {
          groupKey: `g:${group.trim().toLowerCase().replace(/\s+/g, "-")}`,
          groupLabel: group.trim(),
        }
      : {};
  const catalogEmpty =
    catalog.data != null && catalog.data.labor.length === 0 && catalog.data.parts.length === 0;
  const freeReady = description.trim().length > 0 && unitPrice != null && Number(quantity) > 0;
  return (
    <div className="flex flex-col gap-2 pt-2 text-sm [&_.field]:mb-0">
      {showGroup && (
        <div className="max-w-sm">
          <p className="mb-1 text-xs text-muted">{t("lines.groupHint")}</p>
          <Input
            label={t("fields.group")}
            placeholder={t("fields.groupPlaceholder")}
            value={group}
            onChange={(e) => onGroupChange(e.target.value)}
          />
        </div>
      )}

      {mode === "catalog" ? (
        <>
          {catalog.isFetching ? <p className="text-xs text-muted">{t("lines.searching")}</p> : null}
          {catalog.data && !catalogEmpty && (
            <ul className="flex flex-col gap-1">
              {catalog.data.labor.map((op) => (
                <li
                  key={op.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2"
                >
                  <span>
                    🔧 {op.name} · {op.fixedPrice != null ? t("lines.fixed") : `${op.hours} h`} ·{" "}
                    {formatFCFA(op.fixedPrice ?? Math.round(op.hours * op.unitPrice))}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      className="min-h-11"
                      onClick={() =>
                        add.mutate({
                          quoteId: quote.id,
                          type: "LABOR",
                          laborOperationId: op.id,
                          description: op.name,
                          quantity: op.hours || 1,
                          ...groupFields,
                        })
                      }
                    >
                      {t("lines.add")}
                    </Button>
                    {op.isKit && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-11"
                        onClick={() =>
                          addKit.mutate({ quoteId: quote.id, laborOperationId: op.id })
                        }
                      >
                        {t("lines.addKit")}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
              {catalog.data.parts.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2"
                >
                  <span>
                    ⚙ {p.name} · {formatFCFA(p.salePrice)} ·{" "}
                    <span className={p.available ? "text-status-ok" : "text-status-warn"}>
                      {p.available
                        ? t("lines.inStock", { count: p.available })
                        : t("lines.toOrder", { days: p.leadTimeDays })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    className="min-h-11"
                    onClick={() =>
                      add.mutate({
                        quoteId: quote.id,
                        type: "PART",
                        productId: p.id,
                        description: p.name,
                        quantity: 1,
                        ...groupFields,
                      })
                    }
                  >
                    {t("lines.add")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && catalog.data && catalogEmpty && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted">{t("lines.noCatalog", { query: q.trim() })}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDescription(q.trim());
                  setMode("free");
                }}
              >
                {t("lines.useAsFree")}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">
              {t("fields.type")}
              <Select
                value={type}
                className="min-h-11"
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                {(["LABOR", "PART", "SUBCONTRACT", "FEE"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`lineTypes.${k}`)}
                  </option>
                ))}
              </Select>
            </label>
            <Input
              label={`${t("fields.description")} *`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              label={type === "LABOR" ? t("fields.hours") : t("fields.quantity")}
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <MoneyInput
              label={`${t("fields.unitPrice")} *`}
              value={unitPrice}
              onChange={setUnitPrice}
            />
            <Button
              className="min-h-11 sm:col-span-4 sm:w-fit"
              disabled={!freeReady}
              loading={add.isPending}
              onClick={() =>
                add.mutate({
                  quoteId: quote.id,
                  type,
                  description,
                  quantity: Number(quantity),
                  unitPrice: unitPrice ?? 0,
                  ...groupFields,
                })
              }
            >
              {t("lines.addLine")}
            </Button>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label={t("lines.search")}
            placeholder={t("lines.addPlaceholder")}
            value={q}
            className="input-compact"
            leftIcon={<Search size={16} aria-hidden />}
            onChange={(e) => {
              setQ(e.target.value);
              if (mode !== "catalog") setMode("catalog");
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 shrink-0"
          aria-pressed={mode === "free"}
          onClick={() => setMode((current) => (current === "free" ? "catalog" : "free"))}
        >
          + {t("lines.modeFree")}
        </Button>
      </div>
    </div>
  );
}

// ───────────── Totaux, remise globale ─────────────

function Totals({
  quote,
  editable,
  onDone,
  onError,
}: {
  quote: QuoteDetail;
  editable: boolean;
  onDone: () => void;
  onError: (e: { message: string }) => void;
}) {
  const update = trpc.quote.update.useMutation({ onSuccess: onDone, onError });
  let labor = 0;
  let parts = 0;
  for (const line of quote.lines) {
    if (!line.amounts.billable) continue;
    if (line.type === "LABOR") labor += line.amounts.subtotal;
    else parts += line.amounts.subtotal;
  }
  const net = quote.totals.subtotal - quote.totals.discountTotal;
  const rates = [
    ...new Set(quote.lines.filter((line) => line.amounts.billable).map((line) => line.vatRate)),
  ];
  const vatLabel = rates.length === 1 ? t("totals.vatRate", { rate: rates[0]! }) : t("totals.vat");
  const total = quote.totals.total;
  const insurancePct = total > 0 ? Math.round((quote.totals.insuranceShare / total) * 100) : 0;
  const customerPct = total > 0 ? 100 - insurancePct : 100;
  const remise =
    quote.totals.discountTotal > 0
      ? `− ${formatFCFA(quote.totals.discountTotal)}`
      : `— ${formatFCFA(0)}`;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("totals.recap")}
        </h2>
        <dl className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2">
            <dt>{t("totals.labor")}</dt>
            <dd>{formatFCFA(labor)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t("totals.parts")}</dt>
            <dd>{formatFCFA(parts)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t("totals.globalDiscount")}</dt>
            <dd>{remise}</dd>
          </div>
          <div className="flex justify-between gap-2 border-t border-border pt-1.5 font-medium">
            <dt>{t("totals.net")}</dt>
            <dd>{formatFCFA(net)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{vatLabel}</dt>
            <dd>{formatFCFA(quote.totals.vatTotal)}</dd>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-accent/10 px-2 py-2">
            <dt className="font-semibold">{t("totals.total")}</dt>
            <dd className="text-base font-semibold" data-testid="quote-total">
              {formatFCFA(quote.totals.total)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 pt-1 text-xs text-muted">
            <dt>{t("totals.share")}</dt>
            <dd>{t("totals.shareValue", { customer: customerPct, insurance: insurancePct })}</dd>
          </div>
          {quote.totals.insuranceShare > 0 && (
            <>
              <div className="flex justify-between gap-2">
                <dt>{t("totals.insurance")}</dt>
                <dd>{formatFCFA(quote.totals.insuranceShare)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("totals.customer")}</dt>
                <dd>{formatFCFA(quote.totals.customerShare)}</dd>
              </div>
            </>
          )}
          {(quote.acceptedTotal > 0 || DECIDED.has(quote.status)) && (
            <div className="flex justify-between gap-2">
              <dt>{t("totals.accepted")}</dt>
              <dd data-testid="quote-accepted">{formatFCFA(quote.acceptedTotal)}</dd>
            </div>
          )}
          {quote.depositAmount ? (
            <div className="flex justify-between gap-2">
              <dt>{t("totals.deposit")}</dt>
              <dd>{formatFCFA(quote.depositAmount)}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("totals.conditions")}
        </h2>
        {editable ? (
          <div className="grid grid-cols-1 gap-2 [&_.field]:mb-0">
            <Input
              label={t("fields.globalDiscountRate")}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              className="input-compact"
              defaultValue={quote.globalDiscountRate ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Math.round(Number(e.target.value));
                if (v !== quote.globalDiscountRate)
                  update.mutate({ id: quote.id, patch: { globalDiscountRate: v } });
              }}
            />
            <Input
              label={t("totals.validUntil")}
              type="date"
              className="input-compact"
              defaultValue={String(quote.validUntil).slice(0, 10)}
              onBlur={(e) => {
                if (
                  e.target.value &&
                  e.target.value !== new Date(quote.validUntil).toISOString().slice(0, 10)
                ) {
                  update.mutate({
                    id: quote.id,
                    patch: { validUntil: new Date(`${e.target.value}T00:00:00Z`) },
                  });
                }
              }}
            />
            <MoneyInput
              label={t("fields.globalDiscountAmount")}
              value={quote.globalDiscountAmount}
              onChange={(v) => {
                if (v !== quote.globalDiscountAmount)
                  update.mutate({ id: quote.id, patch: { globalDiscountAmount: v } });
              }}
            />
            <label className="flex flex-col gap-1 text-xs">
              {t("fields.discountReason")}
              <Select
                value={quote.discountReason ?? ""}
                className="select-compact min-h-11"
                onChange={(e) =>
                  update.mutate({ id: quote.id, patch: { discountReason: e.target.value || null } })
                }
              >
                <option value="">—</option>
                {["loyal", "fleet", "goodwill", "competition", "other"].map((r) => (
                  <option key={r} value={t(`discountReasons.${r}`)}>
                    {t(`discountReasons.${r}`)}
                  </option>
                ))}
              </Select>
            </label>
            {quote.customer.requiresPurchaseOrder && (
              <Input
                label={t("fields.customerPoNumber")}
                defaultValue={quote.customerPoNumber ?? ""}
                onBlur={(e) =>
                  update.mutate({
                    id: quote.id,
                    patch: { customerPoNumber: e.target.value || null },
                  })
                }
              />
            )}
          </div>
        ) : (
          <p className="text-sm">
            {t("validUntil", { date: formatDay(quote.validUntil, quote.timeZone) })}
          </p>
        )}
      </section>
      {quote.margin != null && (
        <section className="rounded-lg border border-status-ok/30 bg-status-ok-bg p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-ok">
            {t("totals.margin")}
          </p>
          <p className="text-xs text-muted">{t("totals.marginPrivate")}</p>
          <p className="mt-1 text-right text-lg font-semibold text-status-ok">
            {formatFCFA(quote.margin)}
          </p>
        </section>
      )}
    </div>
  );
}

// ───────────── Frise, versions, relances ─────────────

function Timeline({ quote }: { quote: QuoteDetail }) {
  const events: { at: Date | string; label: string }[] = [
    { at: quote.createdAt, label: t("timeline.created") },
    ...(quote.sentAt
      ? [
          {
            at: quote.sentAt,
            label: t("timeline.sent", {
              channel: t(`sendChannels.${quote.sentVia ?? "LINK_ONLY"}`),
            }),
          },
        ]
      : []),
    ...(quote.viewedAt ? [{ at: quote.viewedAt, label: t("timeline.viewed") }] : []),
    ...quote.reminders
      .filter((r) => r.sentAt && r.quoteId === quote.id)
      .map((r) => ({ at: r.sentAt!, label: t("timeline.followup", { step: r.stepKey }) })),
    ...(quote.decidedAt
      ? [
          {
            at: quote.decidedAt,
            label: t("timeline.decided", {
              status: t(`status.${quote.status}`),
              channel: t(`channels.${quote.decisionChannel ?? "portal"}`),
            }),
          },
        ]
      : []),
    ...(quote.convertedAt ? [{ at: quote.convertedAt, label: t("timeline.converted") }] : []),
    ...quote.timeline
      .filter((a) => !["quote.sent"].includes(a.action))
      .map((a) => ({
        at: a.createdAt,
        label: `${t(`auditActions.${a.action.replace("quote.", "")}`)}${a.by ? ` — ${a.by}` : ""}${a.reason ? ` (${a.reason})` : ""}`,
      })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {events.map((e, i) => (
        <li key={i} className="flex flex-wrap gap-2">
          <span className="text-muted">{formatDateTime(e.at, quote.timeZone)}</span>
          <span>{e.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Versions({ quote }: { quote: QuoteDetail }) {
  return (
    <section className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-col gap-1">
        {quote.versions.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface p-2"
          >
            <Link href={`/devis/${v.id}`} className="text-accent">
              {t("versionShort", { version: v.version })}
            </Link>
            <QuoteStatusBadge status={v.status} />
            <span>{formatFCFA(v.total)}</span>
          </li>
        ))}
      </ul>
      {quote.diff && (
        <div className="rounded-md bg-surface-2 p-2">
          <p className="font-semibold">{t("versions.diffTitle", { version: quote.version - 1 })}</p>
          {quote.diff.added.map((l, i) => (
            <p key={`a${i}`} className="text-status-ok">
              + {l.description}
            </p>
          ))}
          {quote.diff.removed.map((l, i) => (
            <p key={`r${i}`} className="text-status-bad">
              − {l.description}
            </p>
          ))}
          {quote.diff.changed.map((c, i) => (
            <p key={`c${i}`} className="text-status-warn">
              ~ {c.after.description} : {formatFCFA(c.before.unitPrice)} →{" "}
              {formatFCFA(c.after.unitPrice)}
              {c.before.quantity !== c.after.quantity
                ? ` · ${c.before.quantity} → ${c.after.quantity}`
                : ""}
            </p>
          ))}
          <p>
            {t("versions.totalDelta", {
              before: formatFCFA(quote.diff.totalBefore),
              after: formatFCFA(quote.diff.totalAfter),
            })}
          </p>
        </div>
      )}
    </section>
  );
}

function Reminders({ quote }: { quote: QuoteDetail }) {
  if (quote.reminders.length === 0)
    return <p className="text-sm text-muted">{t("reminders.none")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {quote.reminders.map((r) => (
        <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-surface p-2">
          <span>{r.stepKey}</span>
          <span>{t(`reminders.status.${r.status}`)}</span>
          <span className="text-muted">{formatDay(r.sentAt ?? r.dueDate, quote.timeZone)}</span>
        </li>
      ))}
    </ul>
  );
}
