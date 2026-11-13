// Adaptateur SMS SMPP v3.4 (opérateur ou agrégateur qui ne fournit qu'un accès SMPP) —
// M11 §4.4, RG-M11-04, RG-M11-14, RG-M11-15.
//
// Une session courte par envoi : bind_transmitter → submit_sm (un par segment) → unbind.
// Volume d'un garage = quelques dizaines de SMS par jour : pas besoin de garder une connexion
// ouverte. Conséquence : pas d'accusé de livraison (deliver_sm arrive sur un bind receiver
// permanent, non géré ici) ; le message reste `SENT` (RG-M11-16, absence d'accusé).

import { createHash } from "node:crypto";
import { encodeSms, type SmsDefaultAlphabet } from "@atelieros/core";
import type {
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderErrorCategory,
  SendResult,
} from "../types";
import {
  encodeBindTransmitter,
  encodeSubmitSm,
  readCString,
  SMPP_COMMANDS,
  SMPP_STATUS,
  type SmppAddress,
  type SmppPdu,
} from "./smpp-pdu";
import { SmppNetworkError, SmppSession } from "./smpp-session";

/**
 * Identifiants saisis dans Paramètres › Canaux (valeurs texte du formulaire) ou dans
 * PLATFORM_SMS_CREDENTIALS. `port`, `tls` acceptent aussi nombre / booléen.
 */
export interface SmppCredentials {
  host: string;
  port: number | string;
  systemId: string;
  password: string;
  systemType?: string;
  /** Expéditeur : nom alphanumérique ≤ 11 car. (ex. GARAGEKONE) ou numéro. */
  sourceAddr: string;
  tls?: boolean | string;
  /** Alphabet par défaut du SMSC pour data_coding 0 (voir encodeSms). */
  defaultAlphabet?: SmsDefaultAlphabet;
}

export interface SmppDeps {
  /** Délai de connexion / réponse (ms) — réduit dans les tests. */
  timeoutMs?: number;
}

export class SmppProviderError extends Error {
  constructor(
    message: string,
    readonly category: ProviderErrorCategory,
    readonly providerCode?: string,
  ) {
    super(message);
  }
}

/** RG-M11-07 : classement des command_status SMPP. */
export function classifySmppStatus(status: number): ProviderErrorCategory {
  switch (status) {
    case SMPP_STATUS.ESME_RBINDFAIL:
    case SMPP_STATUS.ESME_RINVPASWD:
    case SMPP_STATUS.ESME_RINVSYSID:
    case SMPP_STATUS.ESME_RINVSRCADR:
    case SMPP_STATUS.ESME_RINVSRCTON:
    case SMPP_STATUS.ESME_RINVSRCNPI:
      return "PERMANENT_CONFIG";
    case SMPP_STATUS.ESME_RINVDSTADR:
    case SMPP_STATUS.ESME_RINVDSTTON:
    case SMPP_STATUS.ESME_RINVDSTNPI:
      return "PERMANENT_RECIPIENT";
    case SMPP_STATUS.ESME_RINVMSGLEN:
      return "PERMANENT_TEMPLATE";
    case SMPP_STATUS.ESME_RTHROTTLED:
    case SMPP_STATUS.ESME_RMSGQFUL:
      return "RATE_LIMIT";
    default:
      return "TEMPORARY";
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  [SMPP_STATUS.ESME_RBINDFAIL]:
    "Connexion SMPP refusée par le serveur (compte ou adresse IP non autorisés).",
  [SMPP_STATUS.ESME_RINVPASWD]: "Identifiants SMPP refusés : mot de passe incorrect.",
  [SMPP_STATUS.ESME_RINVSYSID]: "Identifiants SMPP refusés : system_id inconnu.",
  [SMPP_STATUS.ESME_RINVSRCADR]:
    "Expéditeur SMS refusé : faites enregistrer ce nom auprès du fournisseur.",
  [SMPP_STATUS.ESME_RINVDSTADR]: "Numéro du destinataire refusé par le fournisseur SMS.",
  [SMPP_STATUS.ESME_RTHROTTLED]:
    "Trop d'envois en même temps : le fournisseur SMS limite le débit.",
  [SMPP_STATUS.ESME_RMSGQFUL]: "File d'attente du fournisseur SMS pleine.",
  [SMPP_STATUS.ESME_RINVMSGLEN]: "Message SMS trop long pour le fournisseur.",
};

function hex(status: number): string {
  return `0x${status.toString(16).padStart(8, "0")}`;
}

function statusError(status: number): SmppProviderError {
  return new SmppProviderError(
    STATUS_MESSAGES[status] ?? `Le serveur SMPP a répondu avec l'erreur ${hex(status)}.`,
    classifySmppStatus(status),
    hex(status),
  );
}

function expectOk(pdu: SmppPdu, expected: number): void {
  if (pdu.commandId === SMPP_COMMANDS.GENERIC_NACK) {
    throw statusError(pdu.commandStatus || SMPP_STATUS.ESME_RSYSERR);
  }
  if (pdu.commandStatus !== SMPP_STATUS.ESME_ROK) throw statusError(pdu.commandStatus);
  if (pdu.commandId !== expected) {
    throw new SmppProviderError("Réponse SMPP inattendue.", "TEMPORARY");
  }
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

/** Expéditeur : numérique → international (TON 1, NPI 1) ; sinon alphanumérique (TON 5). */
export function sourceAddress(sourceAddr: string): SmppAddress {
  const trimmed = sourceAddr.trim();
  if (/^\+?\d+$/.test(trimmed)) return { ton: 1, npi: 1, address: trimmed.replace(/^\+/, "") };
  return { ton: 5, npi: 0, address: trimmed.slice(0, 11) };
}

/** Destinataire E.164 (+225…) → format international sans « + » (TON 1, NPI 1). */
export function destinationAddress(to: string): SmppAddress {
  return { ton: 1, npi: 1, address: to.replace(/[^\d]/g, "") };
}

/** Référence de concaténation dérivée de la clé d'idempotence : stable entre deux tentatives. */
export function concatReference(idempotencyKey: string): number {
  return createHash("sha256").update(idempotencyKey).digest()[0]!;
}

export function createSmppProvider(
  credentials: SmppCredentials,
  deps: SmppDeps = {},
): MessagingProvider {
  const port = Number(credentials.port) || 2775;
  const tls = asBoolean(credentials.tls);

  async function withBoundSession<T>(fn: (session: SmppSession) => Promise<T>): Promise<T> {
    const session = await SmppSession.open({
      host: credentials.host.trim(),
      port,
      tls,
      timeoutMs: deps.timeoutMs,
    });
    try {
      const bind = await session.request(
        SMPP_COMMANDS.BIND_TRANSMITTER,
        encodeBindTransmitter({
          // Espaces de début/fin retirés : un copier-coller en ajoute souvent un, invisible
          // dans le champ masqué, et le SMSC répond alors « mot de passe incorrect ».
          systemId: String(credentials.systemId ?? "").trim(),
          password: String(credentials.password ?? "").trim(),
          systemType: credentials.systemType?.trim() || undefined,
        }),
      );
      expectOk(bind, SMPP_COMMANDS.BIND_TRANSMITTER_RESP);
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  function toProviderError(error: unknown): Error {
    if (error instanceof SmppProviderError) return error;
    if (error instanceof SmppNetworkError) {
      return new SmppProviderError(error.message, "TEMPORARY");
    }
    return new SmppProviderError("Erreur inattendue pendant l'envoi SMPP.", "TEMPORARY");
  }

  return {
    channel: "SMS",

    async send(msg: OutboundMessage): Promise<SendResult> {
      const encoded = encodeSms(msg.body, {
        defaultAlphabet: credentials.defaultAlphabet === "latin1" ? "latin1" : "gsm7",
        reference: concatReference(msg.idempotencyKey),
      });
      const source = sourceAddress(credentials.sourceAddr);
      const destination = destinationAddress(msg.to);
      try {
        return await withBoundSession(async (session) => {
          const ids: string[] = [];
          for (const segment of encoded.segments) {
            const response = await session.request(
              SMPP_COMMANDS.SUBMIT_SM,
              encodeSubmitSm({
                source,
                destination,
                esmClass: encoded.concatenated ? 0x40 : 0x00,
                dataCoding: encoded.dataCoding,
                registeredDelivery: 0,
                shortMessage: segment,
              }),
            );
            expectOk(response, SMPP_COMMANDS.SUBMIT_SM_RESP);
            ids.push(readCString(response.body).value);
          }
          // Premier segment = identifiant du message (les accusés éventuels le citent).
          return { providerMessageId: ids[0] ?? "" };
        });
      } catch (error) {
        throw toProviderError(error);
      }
    },

    async verifyWebhook(): Promise<boolean> {
      return false;
    },

    async parseWebhook() {
      return [];
    },

    /** « Vérifier maintenant » : connexion + authentification, sans envoyer de SMS. */
    async healthCheck(): Promise<HealthStatus> {
      try {
        await withBoundSession(async () => undefined);
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: toProviderError(error).message };
      }
    },
  };
}
