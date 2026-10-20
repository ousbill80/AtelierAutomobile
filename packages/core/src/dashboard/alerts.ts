// RG-M12-27 — alertes système calculées par `alerts.scan` : channel_error, sms_balance_low,
// import_stale, receivable_45d, promise_broken (étape 2.4), credit_limit, discount_high,
// stock_below_min (étape 6.1). Chaque alerte est dédoublonnée par objet et par jour
// (`alert.<code>:<objectId>:<yyyy-MM-dd>`). Les 4 autres codes sont déjà notifiés par leur
// module à l'événement (voir ALERT_NOTIFICATION_TYPES). RG-M12-28 — tri du bloc Alertes.
import { daysOverdue } from "../receivables/aging";
import { asOfDate } from "./receivables";

export const ALERT_CODES = [
  "channel_error",
  "sms_balance_low",
  "import_stale",
  "receivable_45d",
  "promise_broken",
  "credit_limit",
  "discount_high",
  "stock_below_min",
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

/**
 * RG-M12-27 — alertes déjà émises par leur module au moment de l'événement (M04, M08) : le bloc
 * Alertes et le résumé quotidien les lisent sous leur type d'origine, sans doublon.
 */
export const ALERT_NOTIFICATION_TYPES = {
  "cash.variance": "cash_difference",
  "repair_order.late": "ro_late",
  "repair_order.not_collected": "ro_ready_not_delivered",
  "invoice.fne_uncertified": "fne_failed",
} as const;
export type AlertSeverity = "info" | "warning" | "critical";

export const DEFAULT_ALERT_THRESHOLDS = {
  /** % de messages FAILED sur 24 h au-delà duquel le canal est en erreur. */
  channelFailureRatePct: 10,
  channelFailureMinSends: 20,
  smsBalanceMin: 500,
  importStaleDays: 3,
  agentOfflineHours: 24,
  receivableDays: 45,
  /** `settings.discounts.maxRateWithoutApproval` (M08), défaut 15 %. */
  maxDiscountRate: 15,
} as const;
export type AlertThresholds = { [K in keyof typeof DEFAULT_ALERT_THRESHOLDS]: number };

export interface AlertCandidate {
  code: AlertCode;
  severity: AlertSeverity;
  objectId: string;
  dedupeKey: string;
  /** Paramètres du libellé (le texte est composé par l'appelant / fr.json). */
  params: Record<string, string | number>;
  link: string;
  /** Rôles destinataires par défaut (RG-M12-27). */
  roles: readonly string[];
}

export interface AlertScanInput {
  /** Jour local `yyyy-MM-dd` (clé de dédoublonnage et calcul des retards). */
  today: string;
  now: Date;
  channels: readonly {
    id: string;
    channel: string;
    provider: string;
    isActive: boolean;
    status: string | null;
    balance: number | null;
  }[];
  /** Messages sortants des dernières 24 h. */
  messages24h: { total: number; failed: number };
  dataSources: readonly {
    id: string;
    name: string;
    isActive: boolean;
    lastRunAt: Date | null;
    lastStatus: string | null;
  }[];
  overdueInvoices: readonly {
    id: string;
    number: string | null;
    customerName: string;
    balance: number;
    dueDate: Date | null;
  }[];
  brokenPromises: readonly { id: string; amount: number; customerName: string }[];
  /** M13 (US-M13-07) : agents locaux ; hors ligne depuis > 24 h → `import_stale`. */
  agents?: readonly { id: string; name: string; status: string; lastSeenAt: Date | null }[];
  /** Clients dont l'encours dépasse `Customer.creditLimit`. */
  creditLimits?: readonly {
    customerId: string;
    customerName: string;
    outstanding: number;
    creditLimit: number | null;
  }[];
  /** Factures émises récemment avec leur plus forte remise de ligne (%). */
  discountedInvoices?: readonly {
    id: string;
    number: string | null;
    customerName: string;
    maxDiscountRate: number;
  }[];
  /** Événements `stock.below_minimum` du jour (M07). */
  stockBelowMinimum?: readonly {
    productId: string;
    siteId: string;
    productName: string;
    available: number;
  }[];
  thresholds?: Partial<AlertThresholds>;
}

const OWNER = ["OWNER"] as const;
const OWNER_ACCOUNTANT = ["OWNER", "ACCOUNTANT"] as const;
const STOREKEEPER = ["STOREKEEPER"] as const;

function candidate(
  code: AlertCode,
  severity: AlertSeverity,
  objectId: string,
  today: string,
  params: AlertCandidate["params"],
  link: string,
  roles: readonly string[] = OWNER,
): AlertCandidate {
  return {
    code,
    severity,
    objectId,
    dedupeKey: `alert.${code}:${objectId}:${today}`,
    params,
    link,
    roles,
  };
}

export function evaluateAlerts(input: AlertScanInput): AlertCandidate[] {
  const t = { ...DEFAULT_ALERT_THRESHOLDS, ...input.thresholds };
  const alerts: AlertCandidate[] = [];

  for (const config of input.channels) {
    if (!config.isActive) continue;
    if (config.status === "ERROR") {
      alerts.push(
        candidate(
          "channel_error",
          "critical",
          config.id,
          input.today,
          { channel: config.channel },
          "/parametres/canaux",
        ),
      );
    }
    if (config.channel === "SMS" && config.balance !== null && config.balance < t.smsBalanceMin) {
      alerts.push(
        candidate(
          "sms_balance_low",
          "warning",
          config.id,
          input.today,
          { balance: config.balance },
          "/parametres/canaux",
        ),
      );
    }
  }
  const { total, failed } = input.messages24h;
  if (total >= t.channelFailureMinSends && (failed / total) * 100 > t.channelFailureRatePct) {
    alerts.push(
      candidate(
        "channel_error",
        "critical",
        "messages",
        input.today,
        { failedPct: Math.round((failed / total) * 100), failed, total },
        "/messages",
      ),
    );
  }

  const staleMs = t.importStaleDays * 24 * 60 * 60 * 1000;
  for (const source of input.dataSources) {
    if (!source.isActive) continue;
    const lastOk =
      source.lastStatus === "SUCCESS" || source.lastStatus === "COMPLETED"
        ? source.lastRunAt
        : null;
    if (!lastOk || input.now.getTime() - lastOk.getTime() > staleMs) {
      alerts.push(
        candidate(
          "import_stale",
          "warning",
          source.id,
          input.today,
          { name: source.name },
          "/parametres",
        ),
      );
    }
  }

  const agentOfflineMs = t.agentOfflineHours * 60 * 60 * 1000;
  for (const agent of input.agents ?? []) {
    if (agent.status === "REVOKED" || agent.status === "PAIRING") continue;
    if (!agent.lastSeenAt || input.now.getTime() - agent.lastSeenAt.getTime() > agentOfflineMs) {
      alerts.push(
        candidate(
          "import_stale",
          "warning",
          agent.id,
          input.today,
          { name: agent.name, kind: "agent" },
          "/import/agent",
        ),
      );
    }
  }

  for (const invoice of input.overdueInvoices) {
    const days = daysOverdue(invoice.dueDate, asOfDate(input.today));
    if (days <= t.receivableDays || invoice.balance <= 0) continue;
    alerts.push(
      candidate(
        "receivable_45d",
        "warning",
        invoice.id,
        input.today,
        {
          number: invoice.number ?? "",
          customer: invoice.customerName,
          balance: invoice.balance,
          days,
        },
        "/creances",
      ),
    );
  }

  for (const promise of input.brokenPromises) {
    alerts.push(
      candidate(
        "promise_broken",
        "warning",
        promise.id,
        input.today,
        { customer: promise.customerName, amount: promise.amount },
        "/creances",
      ),
    );
  }
  for (const c of input.creditLimits ?? []) {
    if (c.creditLimit === null || c.creditLimit <= 0 || c.outstanding <= c.creditLimit) continue;
    alerts.push(
      candidate(
        "credit_limit",
        "warning",
        c.customerId,
        input.today,
        { customer: c.customerName, outstanding: c.outstanding, creditLimit: c.creditLimit },
        `/clients/${c.customerId}`,
        OWNER_ACCOUNTANT,
      ),
    );
  }

  for (const invoice of input.discountedInvoices ?? []) {
    if (invoice.maxDiscountRate <= t.maxDiscountRate) continue;
    alerts.push(
      candidate(
        "discount_high",
        "info",
        invoice.id,
        input.today,
        {
          number: invoice.number ?? "",
          customer: invoice.customerName,
          rate: invoice.maxDiscountRate,
        },
        `/factures/${invoice.id}`,
      ),
    );
  }

  for (const item of input.stockBelowMinimum ?? []) {
    alerts.push(
      candidate(
        "stock_below_min",
        "warning",
        `${item.productId}:${item.siteId}`,
        input.today,
        { product: item.productName, available: item.available },
        `/stock/${item.productId}`,
        STOREKEEPER,
      ),
    );
  }
  return alerts;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** RG-M12-28 : non lues, triées par sévérité (critical > warning > info) puis date décroissante. */
export function sortAlerts<
  T extends { severity: string | null; createdAt: Date; readAt: Date | null },
>(alerts: readonly T[], limit = 5): T[] {
  return alerts
    .filter((a) => a.readAt === null)
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity ?? "info"] ?? 2) - (SEVERITY_RANK[b.severity ?? "info"] ?? 2) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, limit);
}
