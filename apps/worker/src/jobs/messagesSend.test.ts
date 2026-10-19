import { adminDb } from "@atelieros/db";
import { encryptSecret, loadEncryptionKey } from "@atelieros/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { processMessagesSendJob } from "./messagesSend";
import { getMessagesQueue, type MessagesSendJobData } from "../queues/messages";

function fakeJob(messageId: string): Job<MessagesSendJobData> {
  return {
    data: { messageId },
    moveToDelayed: vi.fn(),
  } as unknown as Job<MessagesSendJobData>;
}

describe("processMessagesSendJob — NOT_ON_WHATSAPP (US-M11-01, RG-M11-05, RG-M11-06)", () => {
  let org: { id: string };
  let customer: { id: string };
  const key = loadEncryptionKey();

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Send Test" } });
    await adminDb.channelConfig.create({
      data: {
        organizationId: org.id,
        channel: "WHATSAPP",
        provider: "whatsapp_cloud",
        isActive: true,
        priority: 1,
        credentials: encryptSecret(
          JSON.stringify({
            phoneNumberId: "PHONE_SEND_TEST",
            wabaId: "WABA_SEND_TEST",
            accessToken: "token",
            appSecret: "secret",
            verifyToken: "verify",
          }),
          key,
        ),
      },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: org.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
    customer = await adminDb.customer.create({
      data: {
        organizationId: org.id,
        displayName: "M. Kouassi",
        type: "INDIVIDUAL",
        phone: "+2250747218890",
        hasWhatsapp: null,
      },
    });
  });

  afterAll(async () => {
    await adminDb.messageAttempt.deleteMany({ where: { organizationId: org.id } });
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
    await getMessagesQueue().close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("repli immédiat vers SMS et Customer.hasWhatsapp = false sur erreur Meta 131026", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 131026, message: "Recipient not on WhatsApp" } }),
          {
            status: 400,
          },
        ),
      ),
    );

    const message = await adminDb.message.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: "WHATSAPP",
        to: "+2250747218890",
        body: "Votre VT (2547 GH 01) expire le 30/11/2026.",
        status: "QUEUED",
        provider: "whatsapp_cloud",
        kind: "REMINDER",
        idempotencyKey: "rem:whatsapp-fallback-test",
      },
    });

    await processMessagesSendJob(fakeJob(message.id));

    const original = await adminDb.message.findFirst({ where: { id: message.id } });
    expect(original?.status).toBe("FAILED");
    expect(original?.errorCode).toBe("131026");

    const updatedCustomer = await adminDb.customer.findFirst({ where: { id: customer.id } });
    expect(updatedCustomer?.hasWhatsapp).toBe(false);

    const fallback = await adminDb.message.findFirst({ where: { fallbackOfId: message.id } });
    expect(fallback).not.toBeNull();
    expect(fallback?.channel).toBe("SMS");
    expect(fallback?.body).toBe(message.body);
    expect(fallback?.idempotencyKey).toBe("rem:whatsapp-fallback-test");

    vi.unstubAllGlobals();
  });
});
