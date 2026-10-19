// M07 §14 — paramètres `Organization.settings.stock`, fusionnés avec les défauts.
export interface StockSettings {
  allowNegative: boolean;
  dormantDays: number;
  countApprovalThreshold: number;
  autoIssueOnInvoice: boolean;
  customerPartFee: number;
}

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  allowNegative: false,
  dormantDays: 180,
  countApprovalThreshold: 50_000,
  autoIssueOnInvoice: true,
  customerPartFee: 0,
};

export function stockSettingsFrom(settings: unknown): StockSettings {
  const raw =
    settings && typeof settings === "object"
      ? ((settings as Record<string, unknown>).stock as Record<string, unknown> | undefined)
      : undefined;
  const out = { ...DEFAULT_STOCK_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.allowNegative === "boolean") out.allowNegative = raw.allowNegative;
  if (typeof raw.autoIssueOnInvoice === "boolean") out.autoIssueOnInvoice = raw.autoIssueOnInvoice;
  for (const key of ["dormantDays", "countApprovalThreshold", "customerPartFee"] as const) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = Math.round(v);
  }
  return out;
}
