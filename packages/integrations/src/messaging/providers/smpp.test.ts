import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifySmppStatus,
  concatReference,
  createSmppProvider,
  destinationAddress,
  sourceAddress,
  type SmppCredentials,
} from "./smpp";
import {
  decodeBindTransmitter,
  decodePdus,
  decodeSubmitSm,
  encodePdu,
  SMPP_COMMANDS,
  SMPP_STATUS,
  type DecodedSubmitSm,
  type SmppPdu,
} from "./smpp-pdu";

/** Faux SMSC : enregistre les PDU reçus et répond selon les options du test. */
interface FakeSmscOptions {
  bindStatus?: number;
  submitStatus?: number;
  /** Ne répond jamais au submit_sm (test de délai). */
  silentSubmit?: boolean;
  /** Envoie un enquire_link au client juste après le bind. */
  enquireAfterBind?: boolean;
}

interface FakeSmsc {
  port: number;
  binds: ReturnType<typeof decodeBindTransmitter>[];
  submits: DecodedSubmitSm[];
  received: SmppPdu[];
  close: () => Promise<void>;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

async function startFakeSmsc(options: FakeSmscOptions = {}): Promise<FakeSmsc> {
  const state: Omit<FakeSmsc, "port" | "close"> = { binds: [], submits: [], received: [] };
  let messageCounter = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer: Buffer = Buffer.alloc(0);
    const send = (pdu: SmppPdu) => socket.write(encodePdu(pdu));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodePdus(buffer);
      buffer = decoded.rest;
      for (const pdu of decoded.pdus) {
        state.received.push(pdu);
        const base = { sequenceNumber: pdu.sequenceNumber, body: Buffer.alloc(0) };
        switch (pdu.commandId) {
          case SMPP_COMMANDS.BIND_TRANSMITTER:
            state.binds.push(decodeBindTransmitter(pdu.body));
            send({
              ...base,
              commandId: SMPP_COMMANDS.BIND_TRANSMITTER_RESP,
              commandStatus: options.bindStatus ?? 0,
              body: Buffer.from("SMSC\0"),
            });
            if (options.enquireAfterBind) {
              send({
                commandId: SMPP_COMMANDS.ENQUIRE_LINK,
                commandStatus: 0,
                sequenceNumber: 9000,
                body: Buffer.alloc(0),
              });
            }
            break;
          case SMPP_COMMANDS.SUBMIT_SM: {
            state.submits.push(decodeSubmitSm(pdu.body));
            if (options.silentSubmit) break;
            messageCounter += 1;
            const status = options.submitStatus ?? 0;
            send({
              ...base,
              commandId: SMPP_COMMANDS.SUBMIT_SM_RESP,
              commandStatus: status,
              body: status === 0 ? Buffer.from(`msg-${messageCounter}\0`) : Buffer.alloc(0),
            });
            break;
          }
          case SMPP_COMMANDS.UNBIND:
            send({ ...base, commandId: SMPP_COMMANDS.UNBIND_RESP, commandStatus: 0 });
            socket.end();
            break;
          default:
            break;
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    ...state,
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
    },
  };
}

function credentials(port: number, extra: Partial<SmppCredentials> = {}): SmppCredentials {
  return {
    host: "127.0.0.1",
    port: String(port),
    systemId: "garage",
    password: "s3cret",
    sourceAddr: "GARAGEKONE",
    ...extra,
  };
}

const message = (body: string, to = "+2250747218890") => ({
  organizationId: "org_1",
  to,
  channel: "SMS" as const,
  body,
  idempotencyKey: "rem:1",
});

describe("createSmppProvider.send", () => {
  it("bind_transmitter, submit_sm puis unbind ; renvoie le message_id du SMSC", async () => {
    const smsc = await startFakeSmsc();
    const provider = createSmppProvider(credentials(smsc.port, { systemType: "SMS" }));

    const result = await provider.send(message("Votre véhicule est réparé."));

    expect(result).toEqual({ providerMessageId: "msg-1" });
    expect(smsc.binds).toEqual([{ systemId: "garage", password: "s3cret", systemType: "SMS" }]);
    expect(smsc.submits).toHaveLength(1);
    const submit = smsc.submits[0]!;
    expect(submit.source).toEqual({ ton: 5, npi: 0, address: "GARAGEKONE" });
    expect(submit.destination).toEqual({ ton: 1, npi: 1, address: "2250747218890" });
    expect(submit.esmClass).toBe(0);
    expect(submit.dataCoding).toBe(0);
    expect(submit.registeredDelivery).toBe(0);
    expect(submit.shortMessage.length).toBe("Votre véhicule est réparé.".length);
    expect(smsc.received.map((p) => p.commandId)).toEqual([
      SMPP_COMMANDS.BIND_TRANSMITTER,
      SMPP_COMMANDS.SUBMIT_SM,
      SMPP_COMMANDS.UNBIND,
    ]);
  });

  it("identifiant et mot de passe longs envoyés en entier (jamais tronqués)", async () => {
    const smsc = await startFakeSmsc();
    await createSmppProvider(
      credentials(smsc.port, { systemId: "garage_kone_frere_ci", password: "MotDePasse2026!" }),
    ).healthCheck();
    expect(smsc.binds[0]).toMatchObject({
      systemId: "garage_kone_frere_ci",
      password: "MotDePasse2026!",
    });
  });

  it("message long : un submit_sm par segment, esm_class UDH, même référence", async () => {
    const smsc = await startFakeSmsc();
    const provider = createSmppProvider(credentials(smsc.port));

    const result = await provider.send(message("a".repeat(200)));

    expect(result.providerMessageId).toBe("msg-1");
    expect(smsc.submits).toHaveLength(2);
    const reference = concatReference("rem:1");
    smsc.submits.forEach((submit, index) => {
      expect(submit.esmClass).toBe(0x40);
      expect([...submit.shortMessage.subarray(0, 6)]).toEqual([5, 0, 3, reference, 2, index + 1]);
    });
  });

  it("texte hors GSM-7 : data_coding 8 (UCS-2)", async () => {
    const smsc = await startFakeSmsc();
    await createSmppProvider(credentials(smsc.port)).send(message("Façade"));
    expect(smsc.submits[0]!.dataCoding).toBe(8);
  });

  it("alphabet Latin-1 configuré : data_coding 3", async () => {
    const smsc = await startFakeSmsc();
    await createSmppProvider(credentials(smsc.port, { defaultAlphabet: "latin1" })).send(
      message("Révision"),
    );
    expect(smsc.submits[0]!.dataCoding).toBe(3);
    expect(smsc.submits[0]!.shortMessage.toString("latin1")).toBe("Révision");
  });

  it("répond aux enquire_link du SMSC pendant la session", async () => {
    const smsc = await startFakeSmsc({ enquireAfterBind: true });
    await createSmppProvider(credentials(smsc.port)).send(message("ok"));
    expect(smsc.received.some((p) => p.commandId === SMPP_COMMANDS.ENQUIRE_LINK_RESP)).toBe(true);
  });

  it("mot de passe refusé → PERMANENT_CONFIG, sans le secret dans le message", async () => {
    const smsc = await startFakeSmsc({ bindStatus: SMPP_STATUS.ESME_RINVPASWD });
    const error = (await createSmppProvider(credentials(smsc.port))
      .send(message("x"))
      .catch((e: unknown) => e)) as Error & { category: string; providerCode: string };

    expect(error).toMatchObject({ category: "PERMANENT_CONFIG", providerCode: "0x0000000e" });
    expect(error.message).not.toContain("s3cret");
    expect(smsc.submits).toHaveLength(0);
  });

  it("destinataire refusé → PERMANENT_RECIPIENT", async () => {
    const smsc = await startFakeSmsc({ submitStatus: SMPP_STATUS.ESME_RINVDSTADR });
    await expect(
      createSmppProvider(credentials(smsc.port)).send(message("x")),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT" });
  });

  it("débit limité → RATE_LIMIT", async () => {
    const smsc = await startFakeSmsc({ submitStatus: SMPP_STATUS.ESME_RTHROTTLED });
    await expect(
      createSmppProvider(credentials(smsc.port)).send(message("x")),
    ).rejects.toMatchObject({ category: "RATE_LIMIT" });
  });

  it("SMSC muet → erreur TEMPORARY après le délai", async () => {
    const smsc = await startFakeSmsc({ silentSubmit: true });
    await expect(
      createSmppProvider(credentials(smsc.port), { timeoutMs: 200 }).send(message("x")),
    ).rejects.toMatchObject({ category: "TEMPORARY" });
  });

  it("serveur injoignable → TEMPORARY", async () => {
    const smsc = await startFakeSmsc();
    const port = smsc.port;
    await new Promise((r) => servers.pop()!.close(() => r(null)));
    await expect(
      createSmppProvider(credentials(port), { timeoutMs: 1_000 }).send(message("x")),
    ).rejects.toMatchObject({ category: "TEMPORARY" });
  });
});

describe("createSmppProvider.healthCheck", () => {
  it("ok : bind puis unbind, aucun SMS envoyé", async () => {
    const smsc = await startFakeSmsc();
    expect(await createSmppProvider(credentials(smsc.port)).healthCheck()).toEqual({ ok: true });
    expect(smsc.submits).toHaveLength(0);
    expect(smsc.binds).toHaveLength(1);
  });

  it("identifiants refusés : détail en français", async () => {
    const smsc = await startFakeSmsc({ bindStatus: SMPP_STATUS.ESME_RINVSYSID });
    const health = await createSmppProvider(credentials(smsc.port)).healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("system_id");
  });
});

describe("adresses et classement", () => {
  it("expéditeur numérique → TON 1 / NPI 1 sans « + »", () => {
    expect(sourceAddress("+2250700000000")).toEqual({ ton: 1, npi: 1, address: "2250700000000" });
  });

  it("expéditeur alphanumérique tronqué à 11 caractères", () => {
    expect(sourceAddress("GARAGE KONE FRERES").address).toBe("GARAGE KONE");
  });

  it("destinataire E.164 → chiffres seuls", () => {
    expect(destinationAddress("+225 07 47 21 88 90").address).toBe("2250747218890");
  });

  it.each([
    [SMPP_STATUS.ESME_RINVPASWD, "PERMANENT_CONFIG"],
    [SMPP_STATUS.ESME_RINVSRCADR, "PERMANENT_CONFIG"],
    [SMPP_STATUS.ESME_RINVDSTADR, "PERMANENT_RECIPIENT"],
    [SMPP_STATUS.ESME_RINVMSGLEN, "PERMANENT_TEMPLATE"],
    [SMPP_STATUS.ESME_RTHROTTLED, "RATE_LIMIT"],
    [SMPP_STATUS.ESME_RSYSERR, "TEMPORARY"],
    [0x45, "TEMPORARY"],
  ])("command_status %s → %s", (status, category) => {
    expect(classifySmppStatus(status)).toBe(category);
  });
});
