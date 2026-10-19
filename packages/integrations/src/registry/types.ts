import type { MessageChannel } from "../messaging/types";

/** Vrai pour les fournisseurs "sans compte réel" (console/manual), jamais chiffrés en base. */
export function isLocalProvider(provider: string): boolean {
  return provider === "console" || provider === "manual";
}

/** Forme minimale d'une ligne `ChannelConfig`, indépendante de Prisma. */
export interface MessagingConfigRecord {
  channel: MessageChannel;
  provider: string;
  isActive: boolean;
  priority: number;
  /** Chiffré (AES-256-GCM) sauf pour un fournisseur local. */
  credentials: string;
  senderId: string | null;
}

export interface MessagingConfigStore {
  listActive(organizationId: string, channel: MessageChannel): Promise<MessagingConfigRecord[]>;
}

/** Forme minimale d'une ligne `PaymentProviderConfig`. */
export interface PaymentConfigRecord {
  provider: string;
  isActive: boolean;
  credentials: string;
}

export interface PaymentConfigStore {
  getActive(organizationId: string): Promise<PaymentConfigRecord | undefined>;
}

/** Forme minimale de `FneConfig`. */
export interface FneConfigRecord {
  mode: "api" | "manual" | "disabled";
  isActive: boolean;
  credentials: string | null;
}

export interface FneConfigStore {
  get(organizationId: string): Promise<FneConfigRecord | undefined>;
}
