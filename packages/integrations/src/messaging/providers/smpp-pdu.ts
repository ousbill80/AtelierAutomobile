// SMPP v3.4 — encodage/décodage des PDU utilisés par l'adaptateur `smpp` (M11 §4.4).
// Périmètre volontairement réduit : bind_transmitter, submit_sm, unbind, enquire_link,
// generic_nack et leurs réponses. En-tête : command_length, command_id, command_status,
// sequence_number (4 × uint32 big-endian).

export const SMPP_COMMANDS = {
  GENERIC_NACK: 0x80000000,
  BIND_TRANSMITTER: 0x00000002,
  BIND_TRANSMITTER_RESP: 0x80000002,
  SUBMIT_SM: 0x00000004,
  SUBMIT_SM_RESP: 0x80000004,
  UNBIND: 0x00000006,
  UNBIND_RESP: 0x80000006,
  ENQUIRE_LINK: 0x00000015,
  ENQUIRE_LINK_RESP: 0x80000015,
} as const;

/** Codes command_status utiles au classement des erreurs (SMPP v3.4 §5.1.3). */
export const SMPP_STATUS = {
  ESME_ROK: 0x00,
  ESME_RINVMSGLEN: 0x01,
  ESME_RSYSERR: 0x08,
  ESME_RINVSRCADR: 0x0a,
  ESME_RINVDSTADR: 0x0b,
  ESME_RBINDFAIL: 0x0d,
  ESME_RINVPASWD: 0x0e,
  ESME_RINVSYSID: 0x0f,
  ESME_RMSGQFUL: 0x14,
  ESME_RINVDSTTON: 0x50,
  ESME_RINVDSTNPI: 0x51,
  ESME_RINVSRCTON: 0x48,
  ESME_RINVSRCNPI: 0x49,
  ESME_RTHROTTLED: 0x58,
} as const;

export const SMPP_HEADER_LENGTH = 16;
/** Garde-fou contre un flux corrompu : aucun PDU utile ne dépasse quelques Ko. */
export const SMPP_MAX_PDU_LENGTH = 64 * 1024;

export interface SmppPdu {
  commandId: number;
  commandStatus: number;
  sequenceNumber: number;
  body: Buffer;
}

export function encodePdu(pdu: SmppPdu): Buffer {
  const header = Buffer.alloc(SMPP_HEADER_LENGTH);
  header.writeUInt32BE(SMPP_HEADER_LENGTH + pdu.body.length, 0);
  header.writeUInt32BE(pdu.commandId >>> 0, 4);
  header.writeUInt32BE(pdu.commandStatus >>> 0, 8);
  header.writeUInt32BE(pdu.sequenceNumber >>> 0, 12);
  return Buffer.concat([header, pdu.body]);
}

/**
 * Extrait les PDU complets de `buffer`. Renvoie aussi le reste (PDU incomplet en attente).
 * Lève une erreur si la longueur annoncée est incohérente (flux à fermer).
 */
export function decodePdus(buffer: Buffer): { pdus: SmppPdu[]; rest: Buffer } {
  const pdus: SmppPdu[] = [];
  let offset = 0;
  while (buffer.length - offset >= SMPP_HEADER_LENGTH) {
    const length = buffer.readUInt32BE(offset);
    if (length < SMPP_HEADER_LENGTH || length > SMPP_MAX_PDU_LENGTH) {
      throw new Error(`PDU SMPP invalide (longueur ${length}).`);
    }
    if (buffer.length - offset < length) break;
    pdus.push({
      commandId: buffer.readUInt32BE(offset + 4),
      commandStatus: buffer.readUInt32BE(offset + 8),
      sequenceNumber: buffer.readUInt32BE(offset + 12),
      body: Buffer.from(buffer.subarray(offset + SMPP_HEADER_LENGTH, offset + length)),
    });
    offset += length;
  }
  return { pdus, rest: Buffer.from(buffer.subarray(offset)) };
}

/** C-Octet String : ASCII terminé par NUL, tronqué à `maxLength - 1` caractères utiles. */
function cString(value: string, maxLength: number): Buffer {
  const text = Buffer.from(value, "latin1").subarray(0, maxLength - 1);
  return Buffer.concat([text, Buffer.from([0])]);
}

export interface BindTransmitterBody {
  systemId: string;
  password: string;
  systemType?: string;
}

export function encodeBindTransmitter(body: BindTransmitterBody): Buffer {
  return Buffer.concat([
    cString(body.systemId, 16),
    cString(body.password, 9),
    cString(body.systemType ?? "", 13),
    Buffer.from([0x34, 0x00, 0x00]), // interface_version 3.4, addr_ton, addr_npi
    cString("", 41), // address_range
  ]);
}

export interface SmppAddress {
  ton: number;
  npi: number;
  address: string;
}

export interface SubmitSmBody {
  source: SmppAddress;
  destination: SmppAddress;
  esmClass: number;
  dataCoding: number;
  registeredDelivery: number;
  shortMessage: Uint8Array;
}

export function encodeSubmitSm(body: SubmitSmBody): Buffer {
  if (body.shortMessage.length > 254) {
    throw new RangeError("short_message SMPP limité à 254 octets.");
  }
  return Buffer.concat([
    cString("", 6), // service_type
    Buffer.from([body.source.ton, body.source.npi]),
    cString(body.source.address, 21),
    Buffer.from([body.destination.ton, body.destination.npi]),
    cString(body.destination.address, 21),
    Buffer.from([body.esmClass, 0x00, 0x00]), // esm_class, protocol_id, priority_flag
    cString("", 17), // schedule_delivery_time
    cString("", 17), // validity_period
    Buffer.from([body.registeredDelivery, 0x00, body.dataCoding, 0x00]),
    Buffer.from([body.shortMessage.length]),
    Buffer.from(body.shortMessage),
  ]);
}

/** Lit une C-Octet String à partir de `offset` ; renvoie la valeur et l'offset suivant. */
export function readCString(body: Buffer, offset = 0): { value: string; next: number } {
  const end = body.indexOf(0, offset);
  const stop = end === -1 ? body.length : end;
  return { value: body.subarray(offset, stop).toString("latin1"), next: stop + 1 };
}

export interface DecodedSubmitSm {
  source: SmppAddress;
  destination: SmppAddress;
  esmClass: number;
  registeredDelivery: number;
  dataCoding: number;
  shortMessage: Buffer;
}

/** Décodage de submit_sm (utilisé par les tests et un éventuel SMSC de développement). */
export function decodeSubmitSm(body: Buffer): DecodedSubmitSm {
  let cursor = readCString(body, 0).next; // service_type
  const sourceTon = body[cursor]!;
  const sourceNpi = body[cursor + 1]!;
  const source = readCString(body, cursor + 2);
  cursor = source.next;
  const destinationTon = body[cursor]!;
  const destinationNpi = body[cursor + 1]!;
  const destination = readCString(body, cursor + 2);
  cursor = destination.next;
  const esmClass = body[cursor]!;
  cursor += 3; // esm_class, protocol_id, priority_flag
  cursor = readCString(body, cursor).next; // schedule_delivery_time
  cursor = readCString(body, cursor).next; // validity_period
  const registeredDelivery = body[cursor]!;
  const dataCoding = body[cursor + 2]!;
  const smLength = body[cursor + 4]!;
  const shortMessage = Buffer.from(body.subarray(cursor + 5, cursor + 5 + smLength));
  return {
    source: { ton: sourceTon, npi: sourceNpi, address: source.value },
    destination: { ton: destinationTon, npi: destinationNpi, address: destination.value },
    esmClass,
    registeredDelivery,
    dataCoding,
    shortMessage,
  };
}

/** Décodage de bind_transmitter (tests). */
export function decodeBindTransmitter(body: Buffer): BindTransmitterBody {
  const systemId = readCString(body, 0);
  const password = readCString(body, systemId.next);
  const systemType = readCString(body, password.next);
  return { systemId: systemId.value, password: password.value, systemType: systemType.value };
}
