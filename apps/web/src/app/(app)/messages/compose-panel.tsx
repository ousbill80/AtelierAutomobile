"use client";

// RG-M11 §7.1 : envoi manuel. L'utilisateur choisit un client (pas un identifiant technique),
// un canal qu'il peut recevoir, un modèle ou un texte libre ; le message ouvre la conversation.
import { useState } from "react";
import { X } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { tm } from "./labels";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";

const CHANNEL_LABEL: Record<Channel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

type PickedCustomer = {
  id: string;
  displayName: string;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
};

function channelsFor(customer: PickedCustomer): Channel[] {
  const list: Channel[] = [];
  if (customer.whatsappPhone || customer.phone) list.push("WHATSAPP");
  if (customer.phone) list.push("SMS");
  if (customer.email) list.push("EMAIL");
  return list;
}

export function ComposePanel({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (notice: string) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [channel, setChannel] = useState<Channel>("SMS");
  const [composeBody, setComposeBody] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [waBody, setWaBody] = useState<string | null>(null);

  const needle = query.trim();
  const search = trpc.customer.list.useQuery(
    { q: needle, limit: 8 },
    { enabled: !customer && needle.length >= 2 },
  );
  const { data: templates } = trpc.template.list.useQuery({ channel });
  const invoices = trpc.invoice.list.useQuery(
    { customerId: customer?.id ?? "", view: "open", limit: 20 },
    { enabled: !!customer && !!templateKey },
  );
  const send = trpc.messaging.send.useMutation({
    onSuccess: (result) => {
      const name = customer?.displayName ?? "";
      if (result.waUrl && result.body) {
        setWaUrl(result.waUrl);
        setWaBody(result.body);
        setNotice(tm("openWhatsapp", { name }));
        return;
      }
      void utils.messaging.invalidate();
      onSent(tm(result.message?.provider === "console" ? "sentSimulated" : "sent", { name }));
    },
  });
  const confirmWa = trpc.messaging.waLinkConfirm.useMutation({
    onSuccess: () => {
      void utils.messaging.invalidate();
      onSent(tm("sent", { name: customer?.displayName ?? "" }));
    },
  });

  const available = customer ? channelsFor(customer) : [];
  const channelOk = !!customer && available.includes(channel);
  const selectedTemplate = templates?.find((item) => item.key === templateKey);
  const needsInvoice =
    !!selectedTemplate &&
    /\{\{\s*(?:facture\.|lien\.(?:facture|paiement))/.test(selectedTemplate.body);
  const blocker = !customer
    ? tm("needCustomer")
    : available.length === 0
      ? tm("noContact")
      : !channelOk
        ? tm("needChannel")
        : !templateKey && !composeBody.trim()
          ? tm("needBody")
          : needsInvoice && !invoiceId
            ? tm("needInvoice")
            : undefined;

  function pickCustomer(next: PickedCustomer) {
    setCustomer(next);
    setQuery("");
    const nextChannels = channelsFor(next);
    setChannel(nextChannels.includes("SMS") ? "SMS" : (nextChannels[0] ?? "SMS"));
    setInvoiceId("");
    setWaUrl(null);
    setWaBody(null);
    send.reset();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tm("new")}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 md:items-center md:p-4"
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl md:max-w-xl md:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">{tm("new")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tm("close")}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto">
          <div className="form-dense flex flex-col gap-3 p-5">
            <div className="field">
              <span className="text-[13px] font-semibold">{tm("customer")}</span>
              {customer ? (
                <div className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{customer.displayName}</span>
                    <span className="block truncate text-sm text-muted">
                      {[customer.phone, customer.email].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCustomer(null);
                      setInvoiceId("");
                    }}
                  >
                    {tm("change")}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    aria-label={tm("customer")}
                    value={query}
                    placeholder={tm("searchPlaceholder")}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {needle.length < 2 && (
                    <span className="text-xs text-muted">{tm("searchHint")}</span>
                  )}
                  {needle.length >= 2 && search.isFetching && (
                    <p className="text-sm text-muted">{tm("searching")}</p>
                  )}
                  {(search.data?.items.length ?? 0) > 0 && (
                    <ul className="flex flex-col gap-1">
                      {search.data?.items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:border-accent"
                            onClick={() =>
                              pickCustomer({
                                id: item.id,
                                displayName: item.displayName,
                                phone: item.phone,
                                whatsappPhone: item.whatsappPhone,
                                email: item.email,
                              })
                            }
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.displayName}</span>
                              <span className="block truncate text-xs text-muted">
                                {[item.phone, item.email].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {needle.length >= 2 && search.data && search.data.items.length === 0 && (
                    <p className="text-sm text-muted">{tm("noResult", { query: needle })}</p>
                  )}
                </>
              )}
            </div>

            <label className="field">
              <span className="text-[13px] font-semibold">{tm("channel")}</span>
              <Select
                aria-label={tm("channel")}
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as Channel);
                  setTemplateKey("");
                  setInvoiceId("");
                }}
              >
                {(["WHATSAPP", "SMS", "EMAIL"] as const).map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={!!customer && !available.includes(value)}
                  >
                    {CHANNEL_LABEL[value]}
                  </option>
                ))}
              </Select>
            </label>

            <label className="field">
              <span className="text-[13px] font-semibold">{tm("template")}</span>
              <Select
                aria-label={tm("template")}
                value={templateKey}
                onChange={(e) => {
                  setTemplateKey(e.target.value);
                  setInvoiceId("");
                }}
              >
                <option value="">
                  {channel === "WHATSAPP" ? tm("freeTextWhatsapp") : tm("freeText")}
                </option>
                {templates
                  ?.filter((item) => channel !== "WHATSAPP" || item.whatsappStatus === "APPROVED")
                  .map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
              </Select>
              <span className="text-xs text-muted">{tm("templateHint")}</span>
            </label>

            {needsInvoice && customer && (
              <label className="field">
                <span className="text-[13px] font-semibold">{tm("invoice")}</span>
                <Select
                  aria-label={tm("invoice")}
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                >
                  <option value="">{tm("invoiceNone")}</option>
                  {invoices.data?.items.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {(invoice.number ?? tm("invoiceNone")) + " · " + formatFCFA(invoice.balance)}
                    </option>
                  ))}
                </Select>
                {invoices.data && invoices.data.items.length === 0 && (
                  <span className="text-xs text-muted">{tm("noOpenInvoice")}</span>
                )}
              </label>
            )}

            {!templateKey && (
              <label className="field">
                <span className="text-[13px] font-semibold">{tm("message")}</span>
                <textarea
                  className="textarea min-h-24"
                  placeholder={tm("messagePlaceholder")}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                />
              </label>
            )}

            {blocker && <p className="text-sm text-muted">{blocker}</p>}
            <Button
              type="button"
              className="min-h-11"
              disabled={!!blocker || send.isPending}
              loading={send.isPending}
              onClick={() => {
                if (!customer || blocker) return;
                setWaUrl(null);
                setWaBody(null);
                send.mutate({
                  customerId: customer.id,
                  channel,
                  ...(templateKey
                    ? { templateKey, ...(invoiceId ? { invoiceId } : {}) }
                    : { body: composeBody.trim() }),
                });
              }}
            >
              {tm("send")}
            </Button>
            {send.error && <p className="text-sm text-status-bad">{send.error.message}</p>}
            {waUrl && waBody && customer && (
              <div className="flex flex-col gap-2">
                {notice && (
                  <p
                    className="rounded-md bg-status-ok-bg px-3 py-2 text-sm text-status-ok"
                    role="status"
                  >
                    {notice}
                  </p>
                )}
                <a
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground"
                  href={waUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tm("openWhatsappButton")}
                </a>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  loading={confirmWa.isPending}
                  onClick={() =>
                    confirmWa.mutate({ customerId: customer.id, body: waBody, sent: true })
                  }
                >
                  {tm("confirmSent")}
                </Button>
                {confirmWa.error && (
                  <p className="text-sm text-status-bad">{confirmWa.error.message}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
