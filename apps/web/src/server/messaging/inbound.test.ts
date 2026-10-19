import { adminDb } from "@atelieros/db";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findOrganizationByWhatsappPhoneNumberId,
  recordInboundMessage,
  recordStatusEvent,
} from "./inbound";

describe("recordInboundMessage (RG-M11-18/19)", () => {
  let org: { id: string };
  let customer: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Inbound Test" } });
    customer = await adminDb.customer.create({
      data: {
        organizationId: org.id,
        displayName: "Client Inbound",
        type: "INDIVIDUAL",
        phone: "+2250747218891",
      },
    });
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.optOut.deleteMany({ where: { organizationId: org.id } });
    await adminDb.conversation.deleteMany({ where: { organizationId: org.id } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("rattache le message entrant au client existant et crée la conversation", async () => {
    await recordInboundMessage({
      organizationId: org.id,
      channel: "SMS",
      from: "+2250747218891",
      body: "Oui samedi matin",
      occurredAt: new Date(),
    });
    const conversation = await adminDb.conversation.findFirst({
      where: { organizationId: org.id, channel: "SMS", externalAddress: "+2250747218891" },
    });
    expect(conversation?.customerId).toBe(customer.id);
    expect(conversation?.unreadCount).toBe(1);

    // RG-M10-22 : consommé par reminders.on_event (REPLIED hors STOP).
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: org.id, type: "message.inbound_received" },
      orderBy: { occurredAt: "desc" },
    });
    expect((event?.payload as { stop?: boolean } | null)?.stop).toBe(false);
  });

  it("STOP crée une OptOut globale et n'envoie qu'un seul accusé (pas de doublon)", async () => {
    await recordInboundMessage({
      organizationId: org.id,
      channel: "SMS",
      from: "+2250747218891",
      body: "STOP",
      occurredAt: new Date(),
    });
    const updatedCustomer = await adminDb.customer.findFirst({ where: { id: customer.id } });
    expect(updatedCustomer?.optedOutAt).not.toBeNull();

    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: org.id, type: "message.inbound_received" },
      orderBy: { occurredAt: "desc" },
    });
    expect((event?.payload as { stop?: boolean } | null)?.stop).toBe(true);

    const optOuts = await adminDb.optOut.findMany({ where: { organizationId: org.id } });
    expect(optOuts).toHaveLength(1);
    expect(optOuts[0]?.channel).toBeNull();
    expect(optOuts[0]?.source).toBe("keyword");

    // Un second STOP ne doit pas créer une seconde OptOut.
    await recordInboundMessage({
      organizationId: org.id,
      channel: "SMS",
      from: "+2250747218891",
      body: "Stop",
      occurredAt: new Date(),
    });
    const optOutsAfter = await adminDb.optOut.findMany({ where: { organizationId: org.id } });
    expect(optOutsAfter).toHaveLength(1);
  });

  it("« stop j'ai payé hier » (> 3 mots) n'est pas une désinscription automatique", async () => {
    await adminDb.optOut.deleteMany({ where: { organizationId: org.id } });
    await recordInboundMessage({
      organizationId: org.id,
      channel: "EMAIL",
      from: "autre-client@example.com",
      body: "stop j'ai payé hier",
      occurredAt: new Date(),
    });
    const optOuts = await adminDb.optOut.findMany({ where: { organizationId: org.id } });
    expect(optOuts).toHaveLength(0);
  });
});

describe("recordStatusEvent (RG-M11-11 : statut monotone, idempotence)", () => {
  let org: { id: string };
  let message: { id: string; providerMessageId: string | null };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Status Test" } });
    message = await adminDb.message.create({
      data: {
        organizationId: org.id,
        direction: "OUTBOUND",
        channel: "WHATSAPP",
        to: "+2250747218892",
        body: "Votre VT expire le 30/11.",
        status: "SENT",
        provider: "console",
        providerMessageId: "console_whatsapp_status_test",
        kind: "REMINDER",
      },
    });
  });

  afterAll(async () => {
    await adminDb.messageStatusEvent.deleteMany({ where: { organizationId: org.id } });
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("READ avant DELIVERED : le READ est conservé même si DELIVERED arrive après (webhook désordonné)", async () => {
    await recordStatusEvent({
      organizationId: org.id,
      providerMessageId: message.providerMessageId!,
      status: "READ",
      occurredAt: new Date(),
    });
    let updated = await adminDb.message.findFirst({ where: { id: message.id } });
    expect(updated?.status).toBe("READ");

    await recordStatusEvent({
      organizationId: org.id,
      providerMessageId: message.providerMessageId!,
      status: "DELIVERED",
      occurredAt: new Date(),
    });
    updated = await adminDb.message.findFirst({ where: { id: message.id } });
    expect(updated?.status).toBe("READ"); // jamais écrasé par un statut moins avancé
  });

  it("un webhook dupliqué (providerMessageId, status) est ignoré (idempotence)", async () => {
    const before = await adminDb.messageStatusEvent.count({ where: { organizationId: org.id } });
    await recordStatusEvent({
      organizationId: org.id,
      providerMessageId: message.providerMessageId!,
      status: "READ",
      occurredAt: new Date(),
    });
    const after = await adminDb.messageStatusEvent.count({ where: { organizationId: org.id } });
    expect(after).toBe(before); // aucun nouvel événement, déjà enregistré
  });
});

describe("findOrganizationByWhatsappPhoneNumberId (RG-M11-11 : isolation multi-locataire)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const key = loadEncryptionKey();

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage WhatsApp A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage WhatsApp B" } });
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "WHATSAPP",
        provider: "whatsapp_cloud",
        isActive: true,
        priority: 1,
        credentials: encryptSecret(
          JSON.stringify({
            phoneNumberId: "PHONE_A",
            wabaId: "WABA_A",
            accessToken: "token-a",
            appSecret: "secret-a",
            verifyToken: "verify-a",
          }),
          key,
        ),
      },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgB.id,
        channel: "WHATSAPP",
        provider: "whatsapp_cloud",
        isActive: true,
        priority: 1,
        credentials: encryptSecret(
          JSON.stringify({
            phoneNumberId: "PHONE_B",
            wabaId: "WABA_B",
            accessToken: "token-b",
            appSecret: "secret-b",
            verifyToken: "verify-b",
          }),
          key,
        ),
      },
    });
  });

  afterAll(async () => {
    await adminDb.channelConfig.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("route chaque phone_number_id vers sa propre organisation, jamais l'autre", async () => {
    const matchA = await findOrganizationByWhatsappPhoneNumberId("PHONE_A", (c) =>
      decryptSecret(c, key),
    );
    const matchB = await findOrganizationByWhatsappPhoneNumberId("PHONE_B", (c) =>
      decryptSecret(c, key),
    );
    expect(matchA?.organizationId).toBe(orgA.id);
    expect(matchB?.organizationId).toBe(orgB.id);
    expect(matchA?.organizationId).not.toBe(matchB?.organizationId);
  });

  it("renvoie null pour un phone_number_id inconnu", async () => {
    const match = await findOrganizationByWhatsappPhoneNumberId("PHONE_UNKNOWN", (c) =>
      decryptSecret(c, key),
    );
    expect(match).toBeNull();
  });
});
