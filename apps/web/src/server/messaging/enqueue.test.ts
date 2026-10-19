import { adminDb, db } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingEnqueue, type EnqueueRequest } from "./enqueue";

describe("messagingEnqueue (RG-M11-01)", () => {
  let org: { id: string };
  let customer: { id: string; phone: string | null };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Enqueue Test" } });
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
        displayName: "Client Enqueue",
        type: "INDIVIDUAL",
        phone: "+2250747218890",
      },
    });
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("un même idempotencyKey ne crée qu'un seul message, même appelé deux fois", async () => {
    const tenantDb = db.forTenant({ organizationId: org.id });
    const req: EnqueueRequest = {
      idempotencyKey: "rem:test-dedup",
      kind: "reminder",
      customerId: customer.id,
      to: { phone: customer.phone },
      channels: ["SMS"],
      bodyOverride: "Votre VT expire bientôt.",
    };

    const first = await tenantDb.transaction((tx) => messagingEnqueue(tx, org.id, req));
    const second = await tenantDb.transaction((tx) => messagingEnqueue(tx, org.id, req));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    if (first.created && !second.created && "message" in second) {
      expect(second.message.id).toBe(first.message.id);
    }

    const count = await adminDb.message.count({
      where: { organizationId: org.id, idempotencyKey: "rem:test-dedup" },
    });
    expect(count).toBe(1);
  });

  it("bloque l'envoi si une variable de modèle référencée est manquante", async () => {
    const tenantDb = db.forTenant({ organizationId: org.id });
    await adminDb.messageTemplate.create({
      data: {
        organizationId: org.id,
        key: "tpl_missing_var",
        name: "Modèle variable manquante",
        channel: "SMS",
        body: "Payez ici : {{lien.paiement}}",
        isActive: true,
      },
    });

    await expect(
      tenantDb.transaction((tx) =>
        messagingEnqueue(tx, org.id, {
          idempotencyKey: "rem:test-missing-var",
          kind: "reminder",
          customerId: customer.id,
          to: { phone: customer.phone },
          channels: ["SMS"],
          templateKey: "tpl_missing_var",
          context: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it("renvoie NO_CHANNEL_AVAILABLE si aucun canal n'est éligible", async () => {
    const tenantDb = db.forTenant({ organizationId: org.id });
    const result = await tenantDb.transaction((tx) =>
      messagingEnqueue(tx, org.id, {
        idempotencyKey: "rem:test-no-channel",
        kind: "reminder",
        customerId: customer.id,
        to: {},
        channels: ["EMAIL"],
        bodyOverride: "Test",
      }),
    );
    expect(result.created).toBe(false);
    expect("reason" in result && result.reason).toBe("NO_CHANNEL_AVAILABLE");
  });
});
