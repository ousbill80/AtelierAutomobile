"use client";

// RG-M11 §7.1 : Boîte de réception unifiée & journal omnicanal.
// KPIs en temps réel, recherche instantanée, sélecteur client intelligent avec autocomplétion
// et PlateBadge, sélection visuelle de canal avec statut de la fenêtre Meta 24h,
// liste de conversations enrichie avec IntentBadge IA et statuts de lecture.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import { Button, EmptyState, Modal, PlateBadge, StatusBadge, type StatusTone } from "@atelieros/ui";
import { IntentBadge } from "@/components/ai/intent-badge";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
};

const STATUS_TONE: Record<string, StatusTone> = {
  QUEUED: "off",
  SENDING: "warn",
  SENT: "ok",
  DELIVERED: "ok",
  READ: "ok",
  FAILED: "bad",
  RECEIVED: "ok",
};

interface SelectedCustomer {
  id: string;
  displayName: string;
  phone?: string | null;
  whatsappPhone?: string | null;
  email?: string | null;
  vehicle?: {
    plate: string;
    plateType?: string | null;
    make?: string | null;
    model?: string | null;
  } | null;
}

export default function MessagesPage() {
  const [activeTab, setActiveTab] = useState<"conversations" | "history">("conversations");
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "ASSIGNED_TO_ME" | "UNASSIGNED">("ALL");
  const [channelFilter, setChannelFilter] = useState<"WHATSAPP" | "SMS" | "EMAIL" | "">("");
  const [statusFilter, setStatusFilter] = useState<
    "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED" | ""
  >("");
  const [search, setSearch] = useState("");

  const [previewMessage, setPreviewMessage] = useState<{
    id: string;
    to: string;
    channel: string;
    status: string;
    body: string;
    subject?: string | null;
    errorMessage?: string | null;
    createdAt: Date;
    customerName?: string;
  } | null>(null);

  const utils = trpc.useUtils();

  // Liste des conversations entrantes/bidirectionnelles avec recherche intégrée
  const conversationsQuery = trpc.messaging.conversations.list.useQuery(
    {
      filter,
      channel: channelFilter || undefined,
      search: search.trim() || undefined,
      limit: 50,
    },
    { refetchInterval: 12_000 },
  );

  // Journal des communications sortantes (historique omnicanal)
  const historyQuery = trpc.messaging.history.useQuery(
    {
      channel: channelFilter || undefined,
      status: statusFilter || undefined,
      q: search.trim() || undefined,
      limit: 100,
    },
    { refetchInterval: 15_000, enabled: activeTab === "history" },
  );

  const retrySend = trpc.messaging.retry.useMutation({
    onSuccess: () => {
      void utils.messaging.history.invalidate();
    },
  });

  // Gestion du formulaire de composition d'un nouveau message
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("WHATSAPP");
  const [composeBody, setComposeBody] = useState("");
  const [templateKey, setTemplateKey] = useState(""); // "" = texte libre

  // Recherche de client pour autocomplétion intelligente
  const { data: customerSearchResults, isFetching: isSearchingCustomers } =
    trpc.customer.list.useQuery(
      { q: customerSearchInput.trim(), limit: 6 },
      { enabled: composeOpen && customerSearchInput.trim().length >= 2 && !selectedCustomer },
    );

  const { data: templates } = trpc.template.list.useQuery({ channel }, { enabled: composeOpen });

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setComposeOpen(false);
      setSelectedCustomer(null);
      setCustomerSearchInput("");
      setComposeBody("");
      setTemplateKey("");
      void utils.messaging.history.invalidate();
      void utils.messaging.conversations.list.invalidate();
    },
  });

  const conversationStats = conversationsQuery.data?.stats;
  const historyStats = historyQuery.data?.stats;

  const [now] = useState(() => Date.now());

  // Détection de la fenêtre Meta 24h pour le client sélectionné dans le composeur
  const matchingConversation = useMemo(() => {
    if (!selectedCustomer) return null;
    return conversationsQuery.data?.items.find(
      (conv) => conv.customerId === selectedCustomer.id && conv.channel === "WHATSAPP",
    );
  }, [selectedCustomer, conversationsQuery.data?.items]);

  const isWaWindowOpen = useMemo(() => {
    if (!matchingConversation?.whatsappWindowExpiresAt) return false;
    return new Date(matchingConversation.whatsappWindowExpiresAt).getTime() > now;
  }, [matchingConversation, now]);

  const hasFilter = Boolean(channelFilter || statusFilter || search.trim() || filter !== "ALL");

  const resetFilters = () => {
    setChannelFilter("");
    setStatusFilter("");
    setSearch("");
    setFilter("ALL");
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "CL";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <MessageSquare size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("messagesModule.title")}
              </h1>
              {conversationStats && conversationStats.unreadTotal > 0 && (
                <span className="rounded-full bg-status-bad-bg px-2.5 py-0.5 text-xs font-semibold text-status-bad">
                  {conversationStats.unreadTotal} {t("messagesModule.kpis.unreadMessages")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">{t("messagesModule.subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => setComposeOpen(true)}
            className="h-9 gap-1.5 text-xs shadow-sm"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>{t("messagesModule.compose.button")}</span>
          </Button>
        </div>
      </div>

      {/* KPIs en temps réel : Total conversations, Messages non lus, WhatsApp actifs dans la fenêtre 24h */}
      {conversationsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* KPI 1 : Total conversations */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("conversations");
              setFilter("ALL");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              activeTab === "conversations" && filter === "ALL"
                ? "border-accent bg-accent/5 ring-2 ring-accent"
                : "border-border/80 bg-surface hover:border-accent hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("messagesModule.kpis.totalConversations")}
              </span>
              <Inbox size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {conversationStats?.totalConversations ?? conversationsQuery.data?.items.length ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("messagesModule.kpis.totalConversationsHint")}
            </div>
          </button>

          {/* KPI 2 : Messages non lus */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("conversations");
              setFilter("UNREAD");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              filter === "UNREAD"
                ? "border-status-bad bg-status-bad-bg/30 ring-2 ring-status-bad"
                : "border-border/80 bg-surface hover:border-status-bad hover:bg-status-bad-bg/15"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("messagesModule.kpis.unreadMessages")}
              </span>
              <AlertCircle size={16} className="text-status-bad" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-status-bad">
              {conversationStats?.unreadTotal ?? conversationsQuery.data?.unreadTotal ?? 0}
            </div>
            <div className="mt-1 text-[11px] font-medium text-status-bad">
              {t("messagesModule.kpis.unreadMessagesHint")}
            </div>
          </button>

          {/* KPI 3 : WhatsApp actifs dans la fenêtre 24h */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("conversations");
              setChannelFilter("WHATSAPP");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              channelFilter === "WHATSAPP"
                ? "border-status-ok bg-status-ok-bg/30 ring-2 ring-status-ok"
                : "border-border/80 bg-surface hover:border-status-ok hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("messagesModule.kpis.activeWhatsapp24h")}
              </span>
              <MessageCircle size={16} className="text-status-ok" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {conversationStats?.activeWhatsapp24h ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("messagesModule.kpis.activeWhatsapp24hHint")}
            </div>
          </button>

          {/* KPI 4 : Total messages envoyés (Sortants) */}
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              activeTab === "history"
                ? "border-accent bg-accent/5 ring-2 ring-accent"
                : "border-border/80 bg-surface hover:border-accent hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("messagesModule.kpis.totalSent")}
              </span>
              <Send size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {historyStats?.total ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {historyStats?.failed ? `${historyStats.failed} échec(s)` : "Notifications délivrées"}
            </div>
          </button>
        </div>
      )}

      {/* Modal / Zone de composition avec Sélecteur Client Intelligent et Sélection Visuelle de Canal */}
      {composeOpen && (
        <div className="flex flex-col gap-4 rounded-xl border border-accent/40 bg-surface p-5 shadow-md">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-accent" />
              <h2 className="text-base font-bold text-foreground">
                {t("messagesModule.compose.title")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setComposeOpen(false)}
              className="text-muted hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>

          {/* 1. Sélecteur client intelligent avec autocomplétion */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              {t("messagesModule.compose.clientSelectorLabel")}
            </label>

            {selectedCustomer ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/50 bg-accent/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
                    {getInitials(selectedCustomer.displayName)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {selectedCustomer.displayName}
                      </span>
                      {selectedCustomer.vehicle && (
                        <PlateBadge
                          plate={selectedCustomer.vehicle.plate}
                          plateType={selectedCustomer.vehicle.plateType ?? undefined}
                        />
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {selectedCustomer.whatsappPhone && (
                        <span className="flex items-center gap-1 text-emerald-600 font-mono">
                          <MessageCircle size={12} />
                          {selectedCustomer.whatsappPhone}
                        </span>
                      )}
                      {selectedCustomer.phone && !selectedCustomer.whatsappPhone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone size={12} />
                          {selectedCustomer.phone}
                        </span>
                      )}
                      {selectedCustomer.email && (
                        <span className="flex items-center gap-1">
                          <Mail size={12} />
                          {selectedCustomer.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="h-8 text-xs"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerSearchInput("");
                  }}
                >
                  {t("messagesModule.compose.changeClient")}
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder={t("messagesModule.compose.searchClientPlaceholder")}
                  value={customerSearchInput}
                  onChange={(e) => setCustomerSearchInput(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />

                {isSearchingCustomers && (
                  <p className="mt-1 text-[11px] text-muted">
                    {t("messagesModule.compose.searching")}
                  </p>
                )}

                {customerSearchResults && customerSearchInput.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
                    {customerSearchResults.items.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted">
                        {t("messagesModule.compose.noClientFound")}
                      </p>
                    ) : (
                      customerSearchResults.items.map((cust) => {
                        const primaryVehicle = cust.vehicles[0];
                        return (
                          <button
                            key={cust.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer({
                                id: cust.id,
                                displayName: cust.displayName,
                                phone: cust.phone,
                                whatsappPhone: cust.whatsappPhone,
                                email: cust.email,
                                vehicle: primaryVehicle ?? null,
                              });
                            }}
                            className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-xs transition-colors hover:bg-surface-2"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-foreground">
                                {getInitials(cust.displayName)}
                              </div>
                              <div>
                                <p className="font-semibold text-foreground">{cust.displayName}</p>
                                <p className="text-[11px] text-muted">
                                  {cust.whatsappPhone ?? cust.phone ?? cust.email ?? "Sans contact"}
                                </p>
                              </div>
                            </div>
                            {primaryVehicle && (
                              <PlateBadge
                                plate={primaryVehicle.plate}
                                plateType={primaryVehicle.plateType ?? undefined}
                              />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Sélection visuelle de canal (WhatsApp, SMS, Email) */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-foreground">
              {t("messagesModule.compose.channelLabel")}
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* WhatsApp */}
              <button
                type="button"
                onClick={() => {
                  setChannel("WHATSAPP");
                  setTemplateKey("");
                }}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  channel === "WHATSAPP"
                    ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500"
                    : "border-border bg-surface hover:border-emerald-500/50 hover:bg-surface-2/40"
                }`}
              >
                <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-600">
                  <MessageCircle size={18} />
                </div>
                <div>
                  <p className="font-semibold text-xs text-foreground">
                    {t("messagesModule.compose.channels.WHATSAPP")}
                  </p>
                  <p className="text-[11px] text-muted">
                    {t("messagesModule.compose.channels.WHATSAPP_DESC")}
                  </p>
                </div>
              </button>

              {/* SMS */}
              <button
                type="button"
                onClick={() => {
                  setChannel("SMS");
                  setTemplateKey("");
                }}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  channel === "SMS"
                    ? "border-sky-500 bg-sky-500/10 ring-2 ring-sky-500"
                    : "border-border bg-surface hover:border-sky-500/50 hover:bg-surface-2/40"
                }`}
              >
                <div className="rounded-lg bg-sky-500/20 p-2 text-sky-600">
                  <Smartphone size={18} />
                </div>
                <div>
                  <p className="font-semibold text-xs text-foreground">
                    {t("messagesModule.compose.channels.SMS")}
                  </p>
                  <p className="text-[11px] text-muted">
                    {t("messagesModule.compose.channels.SMS_DESC")}
                  </p>
                </div>
              </button>

              {/* Email */}
              <button
                type="button"
                onClick={() => {
                  setChannel("EMAIL");
                  setTemplateKey("");
                }}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  channel === "EMAIL"
                    ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500"
                    : "border-border bg-surface hover:border-amber-500/50 hover:bg-surface-2/40"
                }`}
              >
                <div className="rounded-lg bg-amber-500/20 p-2 text-amber-600">
                  <Mail size={18} />
                </div>
                <div>
                  <p className="font-semibold text-xs text-foreground">
                    {t("messagesModule.compose.channels.EMAIL")}
                  </p>
                  <p className="text-[11px] text-muted">
                    {t("messagesModule.compose.channels.EMAIL_DESC")}
                  </p>
                </div>
              </button>
            </div>

            {/* Indication claire de la fenêtre 24h Meta pour WhatsApp */}
            {channel === "WHATSAPP" && (
              <div
                className={`mt-1 flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium ${
                  isWaWindowOpen
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                    : "border border-amber-500/30 bg-amber-500/10 text-amber-700"
                }`}
              >
                {isWaWindowOpen ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>{t("messagesModule.compose.waWindow.open")}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                    <span>{t("messagesModule.compose.waWindow.closed")}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 3. Sélecteur de modèles de messages */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              {t("messagesModule.compose.templateLabel")}
            </label>
            <select
              className="h-10 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:border-accent focus:outline-none"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              <option value="">
                {channel === "WHATSAPP" && !isWaWindowOpen
                  ? t("messagesModule.compose.freeTextWaNotice")
                  : t("messagesModule.compose.freeText")}
              </option>
              {templates
                ?.filter((tmpl) => channel !== "WHATSAPP" || tmpl.whatsappStatus === "APPROVED")
                .map((tmpl) => (
                  <option key={tmpl.key} value={tmpl.key}>
                    {tmpl.name}
                  </option>
                ))}
            </select>
          </div>

          {/* 4. Corps du message (si texte libre) */}
          {!templateKey && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t("messagesModule.compose.bodyLabel")}
              </label>
              <textarea
                className="min-h-24 w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground focus:border-accent focus:outline-none"
                placeholder={t("messagesModule.compose.bodyPlaceholder")}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
              />
            </div>
          )}

          {/* Boutons d'action */}
          <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            <Button variant="secondary" onClick={() => setComposeOpen(false)} className="h-9 text-xs">
              {t("messagesModule.compose.cancel")}
            </Button>
            <Button
              className="h-9 gap-1.5 text-xs"
              onClick={() => {
                if (!selectedCustomer) return;
                send.mutate({
                  customerId: selectedCustomer.id,
                  channel,
                  ...(templateKey ? { templateKey } : { body: composeBody.trim() }),
                });
              }}
              disabled={
                send.isPending ||
                !selectedCustomer ||
                (!templateKey && !composeBody.trim())
              }
            >
              <Send size={14} />
              <span>
                {send.isPending
                  ? t("messagesModule.compose.sending")
                  : t("messagesModule.compose.send")}
              </span>
            </Button>
          </div>
          {send.error && <p className="text-xs text-status-bad">{send.error.message}</p>}
        </div>
      )}

      {/* Onglets principaux : Boîte de réception vs Journal des envois sortants */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("conversations")}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-all ${
              activeTab === "conversations"
                ? "bg-accent text-accent-fg shadow-xs"
                : "bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Inbox size={14} />
            <span>{t("messagesModule.tabs.inbox")}</span>
            {conversationStats && conversationStats.unreadTotal > 0 && (
              <span className="rounded-full bg-status-bad px-1.5 py-0.2 text-[10px] font-bold text-white">
                {conversationStats.unreadTotal}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-all ${
              activeTab === "history"
                ? "bg-accent text-accent-fg shadow-xs"
                : "bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Send size={14} />
            <span>{t("messagesModule.tabs.history")}</span>
          </button>
        </div>

        {/* Sous-filtres d'onglets pour la boîte de réception */}
        {activeTab === "conversations" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(["ALL", "UNREAD", "ASSIGNED_TO_ME", "UNASSIGNED"] as const).map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilter(val)}
                className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-all ${
                  filter === val
                    ? "bg-surface-2 font-semibold text-foreground shadow-xs"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t(`messagesModule.tabs.filters.${val}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Barre d'outils et recherche instantanée multi-champs */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder={t("messagesModule.filters.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filtre Canal */}
            <select
              aria-label={t("messagesModule.filters.allChannels")}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as typeof channelFilter)}
            >
              <option value="">{t("messagesModule.filters.allChannels")}</option>
              <option value="WHATSAPP">{t("messagesModule.conversations.channels.WHATSAPP")}</option>
              <option value="SMS">{t("messagesModule.conversations.channels.SMS")}</option>
              <option value="EMAIL">{t("messagesModule.conversations.channels.EMAIL")}</option>
            </select>

            {/* Filtre Statut (pour le journal sortant) */}
            {activeTab === "history" && (
              <select
                aria-label={t("messagesModule.filters.allStatuses")}
                className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="">{t("messagesModule.filters.allStatuses")}</option>
                <option value="DELIVERED">{t("messagesModule.statuses.DELIVERED")}</option>
                <option value="READ">{t("messagesModule.statuses.READ")}</option>
                <option value="SENT">{t("messagesModule.statuses.SENT")}</option>
                <option value="FAILED">{t("messagesModule.statuses.FAILED")}</option>
              </select>
            )}

            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-surface-2 px-2.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <X size={13} />
                <span>{t("messagesModule.filters.reset")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* VUE 1 : Boîte de réception (Liste moderne des conversations) */}
      {activeTab === "conversations" && (
        <div className="flex flex-col gap-3">
          {conversationsQuery.isLoading && (
            <div className="flex flex-col gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-2/60" />
              ))}
            </div>
          )}

          {conversationsQuery.isError && (
            <div className="rounded-xl border border-status-bad bg-status-bad-bg p-4 text-xs text-status-bad">
              Impossible de charger les conversations.
            </div>
          )}

          {conversationsQuery.data && conversationsQuery.data.items.length === 0 && (
            <EmptyState
              title={t("messagesModule.conversations.empty.title")}
              description={t("messagesModule.conversations.empty.description")}
              action={
                hasFilter ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    {t("messagesModule.empty.action")}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setComposeOpen(true)}>
                    {t("messagesModule.compose.button")}
                  </Button>
                )
              }
            />
          )}

          {conversationsQuery.data?.items.map((conv) => {
            const lastMsg = conv.messages?.[0];
            const primaryVehicle = conv.customer?.vehicles?.[0];
            const isUnread = conv.unreadCount > 0;
            const isWaOpen =
              conv.channel === "WHATSAPP" &&
              conv.whatsappWindowExpiresAt != null &&
              new Date(conv.whatsappWindowExpiresAt).getTime() > now;

            return (
              <Link
                key={conv.id}
                href={`/messages/${conv.id}`}
                className={`group flex items-center justify-between gap-4 rounded-xl border p-4 shadow-xs transition-all ${
                  isUnread
                    ? "border-accent/40 bg-accent/5 ring-1 ring-accent/30"
                    : "border-border/80 bg-surface hover:border-border hover:bg-surface-2/30"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  {/* Avatar avec initiales */}
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
                    {getInitials(conv.customer?.displayName ?? conv.externalAddress)}
                    {isUnread && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-status-bad ring-2 ring-surface" />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`truncate text-sm ${
                          isUnread ? "font-bold text-foreground" : "font-semibold text-foreground"
                        }`}
                      >
                        {conv.customer?.displayName ?? conv.externalAddress}
                      </span>

                      {primaryVehicle && (
                        <PlateBadge
                          plate={primaryVehicle.plate}
                          plateType={primaryVehicle.plateType ?? undefined}
                        />
                      )}

                      {/* Badge du canal */}
                      {conv.channel === "WHATSAPP" && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                          <MessageCircle size={12} />
                          <span>{t("messagesModule.conversations.channels.WHATSAPP")}</span>
                        </span>
                      )}
                      {conv.channel === "SMS" && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
                          <Smartphone size={12} />
                          <span>{t("messagesModule.conversations.channels.SMS")}</span>
                        </span>
                      )}
                      {conv.channel === "EMAIL" && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                          <Mail size={12} />
                          <span>{t("messagesModule.conversations.channels.EMAIL")}</span>
                        </span>
                      )}

                      {/* Fenêtre 24h Meta */}
                      {conv.channel === "WHATSAPP" && isWaOpen && (
                        <span
                          className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
                          title="Fenêtre 24h ouverte"
                        >
                          24h ouverte
                        </span>
                      )}
                    </div>

                    {/* Dernier message */}
                    <p
                      className={`truncate text-xs ${
                        isUnread ? "font-medium text-foreground" : "text-muted"
                      }`}
                    >
                      {lastMsg?.body ?? conv.externalAddress}
                    </p>
                  </div>
                </div>

                {/* Partie droite : Badges, Horodatage et statut */}
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                  <div className="flex items-center gap-2">
                    <IntentBadge intent={conv.lastIntent} />
                    {isUnread && (
                      <span className="rounded-full bg-status-bad px-2 py-0.5 text-[11px] font-bold text-white">
                        {t("messagesModule.conversations.unreadBadge", {
                          count: conv.unreadCount,
                        })}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted">
                    {new Date(conv.lastMessageAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* VUE 2 : Journal des envois sortants */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-3">
          {historyQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2/60" />
              ))}
            </div>
          ) : historyQuery.isError ? (
            <div className="rounded-xl border border-status-bad bg-status-bad-bg p-4 text-xs text-status-bad">
              Impossible de charger l&apos;historique des messages.
            </div>
          ) : historyQuery.data?.items.length === 0 ? (
            <EmptyState
              title={t("messagesModule.empty.title")}
              description={t("messagesModule.empty.description")}
              action={
                hasFilter ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    {t("messagesModule.empty.action")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-3.5 pl-4 pr-3">{t("messagesModule.table.recipient")}</th>
                      <th className="px-3 py-3.5">{t("messagesModule.table.channel")}</th>
                      <th className="px-3 py-3.5">{t("messagesModule.table.status")}</th>
                      <th className="px-3 py-3.5">{t("messagesModule.table.preview")}</th>
                      <th className="px-3 py-3.5">{t("messagesModule.table.date")}</th>
                      <th className="py-3.5 pl-3 pr-4 text-right">
                        {t("messagesModule.table.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {historyQuery.data?.items.map((message) => {
                      const isFailed = message.status === "FAILED";
                      return (
                        <tr
                          key={message.id}
                          className="group transition-colors hover:bg-surface-2/40"
                        >
                          <td className="py-3 pl-4 pr-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground">
                                {message.customer?.displayName ?? "Client direct"}
                              </span>
                              <span className="font-mono text-xs text-muted">{message.to}</span>
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              {message.channel === "WHATSAPP" && (
                                <MessageCircle size={14} className="text-status-ok" />
                              )}
                              {message.channel === "SMS" && (
                                <Smartphone size={14} className="text-accent" />
                              )}
                              {message.channel === "EMAIL" && (
                                <Mail size={14} className="text-muted" />
                              )}
                              <span className="text-xs font-medium text-foreground">
                                {CHANNEL_LABEL[message.channel] ?? message.channel}
                              </span>
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <StatusBadge
                                tone={STATUS_TONE[message.status] ?? "off"}
                                label={t(`messagesModule.statuses.${message.status}`)}
                              />
                              {isFailed && message.errorMessage && (
                                <span className="max-w-[200px] truncate text-[11px] font-medium text-status-bad">
                                  {message.errorMessage}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="max-w-[320px] px-3 py-3">
                            <div className="flex flex-col gap-0.5">
                              {message.subject && (
                                <span className="truncate font-semibold text-xs text-foreground">
                                  {message.subject}
                                </span>
                              )}
                              <p className="line-clamp-2 text-xs text-muted">{message.body}</p>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                            {new Date(message.createdAt).toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>

                          <td className="py-3 pl-3 pr-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isFailed && (
                                <Button
                                  variant="secondary"
                                  className="h-8 gap-1 px-2.5 text-xs text-status-bad hover:bg-status-bad-bg/30"
                                  onClick={() => retrySend.mutate({ id: message.id })}
                                  disabled={retrySend.isPending}
                                  title={t("messagesModule.table.resend")}
                                >
                                  <RefreshCw
                                    size={12}
                                    className={retrySend.isPending ? "animate-spin" : ""}
                                  />
                                  <span>{t("messagesModule.table.resend")}</span>
                                </Button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewMessage({
                                    id: message.id,
                                    to: message.to,
                                    channel: message.channel,
                                    status: message.status,
                                    body: message.body,
                                    subject: message.subject,
                                    errorMessage: message.errorMessage,
                                    createdAt: message.createdAt,
                                    customerName: message.customer?.displayName,
                                  })
                                }
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-all hover:border-accent hover:text-foreground"
                                title={t("messagesModule.table.view")}
                              >
                                <Eye size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal d'aperçu complet d'un message */}
      {previewMessage && (
        <Modal
          title={t("messagesModule.previewModal.title", {
            channel: CHANNEL_LABEL[previewMessage.channel] ?? previewMessage.channel,
          })}
          open={Boolean(previewMessage)}
          onClose={() => setPreviewMessage(null)}
        >
          <div className="flex flex-col gap-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <p className="font-semibold text-foreground">
                  {previewMessage.customerName ?? "Client direct"}
                </p>
                <p className="font-mono text-muted">{previewMessage.to}</p>
              </div>
              <StatusBadge
                tone={STATUS_TONE[previewMessage.status] ?? "off"}
                label={t(`messagesModule.statuses.${previewMessage.status}`)}
              />
            </div>

            {previewMessage.errorMessage && (
              <div className="rounded-lg border border-status-bad/40 bg-status-bad-bg/30 p-3 text-status-bad">
                <span className="font-semibold">{t("messagesModule.previewModal.errorTitle")} </span>
                {previewMessage.errorMessage}
              </div>
            )}

            {previewMessage.subject && (
              <div>
                <span className="font-semibold text-muted">{t("messagesModule.previewModal.subject")} </span>
                <p className="font-medium text-foreground">{previewMessage.subject}</p>
              </div>
            )}

            <div>
              <span className="font-semibold text-muted">{t("messagesModule.previewModal.body")} </span>
              <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border/60 bg-surface-2/40 p-3 text-foreground">
                {previewMessage.body}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setPreviewMessage(null)}>
                {t("messagesModule.previewModal.close")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
