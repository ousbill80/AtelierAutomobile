// Session SMPP v3.4 courte (une connexion par envoi) — M11 §4.4.
// Ouvre une socket TCP ou TLS, numérote les requêtes, associe chaque réponse à sa requête par
// sequence_number, répond aux enquire_link / unbind du SMSC et rejette tout en cas de
// coupure ou de délai dépassé. Aucun secret n'apparaît dans les messages d'erreur.

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { decodePdus, encodePdu, SMPP_COMMANDS, type SmppPdu } from "./smpp-pdu";

export interface SmppSessionOptions {
  host: string;
  port: number;
  tls?: boolean;
  /** Délai max de connexion et d'attente de chaque réponse (ms). */
  timeoutMs?: number;
}

/** Erreur réseau (connexion refusée, délai, coupure) : toujours temporaire. */
export class SmppNetworkError extends Error {
  readonly kind = "network" as const;
}

interface Pending {
  resolve: (pdu: SmppPdu) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class SmppSession {
  private buffer: Buffer = Buffer.alloc(0);
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (error) => this.fail(new SmppNetworkError(networkMessage(error))));
    socket.on("close", () => this.fail(new SmppNetworkError("Connexion SMPP fermée.")));
  }

  static open(options: SmppSessionOptions): Promise<SmppSession> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const readyEvent = options.tls ? "secureConnect" : "connect";
      const socket = options.tls
        ? tlsConnect({ host: options.host, port: options.port, servername: options.host })
        : netConnect({ host: options.host, port: options.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new SmppNetworkError("Serveur SMPP injoignable (délai dépassé)."));
      }, timeoutMs);
      const onError = (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new SmppNetworkError(networkMessage(error)));
      };
      socket.once("error", onError);
      socket.once(readyEvent, () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve(new SmppSession(socket, timeoutMs));
      });
    });
  }

  /** Envoie une requête et attend la réponse portant le même sequence_number. */
  request(commandId: number, body: Buffer = Buffer.alloc(0)): Promise<SmppPdu> {
    if (this.closed) return Promise.reject(new SmppNetworkError("Connexion SMPP fermée."));
    this.sequence = this.sequence >= 0x7fffffff ? 1 : this.sequence + 1;
    const sequenceNumber = this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequenceNumber);
        reject(new SmppNetworkError("Le serveur SMPP n'a pas répondu à temps."));
      }, this.timeoutMs);
      this.pending.set(sequenceNumber, { resolve, reject, timer });
      this.socket.write(encodePdu({ commandId, commandStatus: 0, sequenceNumber, body }));
    });
  }

  /** unbind poli puis fermeture ; n'échoue jamais (l'envoi a déjà eu lieu ou non). */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request(SMPP_COMMANDS.UNBIND);
    } catch {
      // SMSC muet ou déjà déconnecté : on ferme quand même.
    }
    this.destroy();
  }

  destroy(): void {
    this.closed = true;
    this.socket.destroy();
    this.fail(new SmppNetworkError("Connexion SMPP fermée."));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let pdus: SmppPdu[];
    try {
      const decoded = decodePdus(this.buffer);
      pdus = decoded.pdus;
      this.buffer = decoded.rest;
    } catch {
      this.destroy();
      return;
    }
    for (const pdu of pdus) this.dispatch(pdu);
  }

  private dispatch(pdu: SmppPdu): void {
    if (pdu.commandId === SMPP_COMMANDS.ENQUIRE_LINK) {
      this.reply(SMPP_COMMANDS.ENQUIRE_LINK_RESP, pdu.sequenceNumber);
      return;
    }
    if (pdu.commandId === SMPP_COMMANDS.UNBIND) {
      this.reply(SMPP_COMMANDS.UNBIND_RESP, pdu.sequenceNumber);
      this.destroy();
      return;
    }
    const isResponse = (pdu.commandId & 0x80000000) !== 0;
    if (!isResponse) {
      // Requête non gérée (deliver_sm sur un bind transmitter, etc.) : generic_nack.
      this.reply(SMPP_COMMANDS.GENERIC_NACK, pdu.sequenceNumber, 0x03);
      return;
    }
    const waiting = this.pending.get(pdu.sequenceNumber);
    if (!waiting) return;
    this.pending.delete(pdu.sequenceNumber);
    clearTimeout(waiting.timer);
    waiting.resolve(pdu);
  }

  private reply(commandId: number, sequenceNumber: number, commandStatus = 0): void {
    if (this.closed) return;
    this.socket.write(
      encodePdu({ commandId, commandStatus, sequenceNumber, body: Buffer.alloc(0) }),
    );
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const [sequenceNumber, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      this.pending.delete(sequenceNumber);
      waiting.reject(error);
    }
  }
}

function networkMessage(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED") return "Serveur SMPP injoignable (connexion refusée).";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "Serveur SMPP introuvable (hôte inconnu).";
  if (code === "ETIMEDOUT") return "Serveur SMPP injoignable (délai dépassé).";
  if (code === "ECONNRESET") return "Connexion SMPP interrompue par le serveur.";
  return "Erreur de connexion au serveur SMPP.";
}
