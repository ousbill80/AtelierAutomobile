import { pickChannel, type Channel } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveChannelCandidates, resolveRecipient } from "./reminderChannel";

// M17 RG-M17-16 — canal préféré (manuel, sinon appris) essayé en premier, toujours soumis aux
// contrôles M10 (OptOut, numéro non WhatsApp, canal actif) au moment de la résolution.

describe("reminderChannel — canal appris (RG-M17-16)", () => {
  let org: { id: string };
  const STEP: Channel[] = ["WHATSAPP", "SMS"];

  async function customer(data: {
    phone: string;
    bestChannel?: Channel | null;
    preferredChannel?: Channel | null;
    hasWhatsapp?: boolean | null;
  }) {
    return adminDb.customer.create({
      data: { organizationId: org.id, displayName: data.phone, type: "INDIVIDUAL", ...data },
    });
  }

  async function picked(customerId: string) {
    const tenantDb = db.forTenant({ organizationId: org.id });
    const row = await tenantDb.customer.findFirstOrThrow({ where: { id: customerId } });
    const recipient = await resolveRecipient(tenantDb, row, "INSPECTION");
    const { candidates } = await resolveChannelCandidates(tenantDb, recipient!, STEP);
    return pickChannel({ candidates }).channel;
  }

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Canal Appris" } });
    await adminDb.channelConfig.createMany({
      data: (["WHATSAPP", "SMS"] as const).map((channel) => ({
        organizationId: org.id,
        channel,
        provider: "console",
        isActive: true,
        credentials: "",
      })),
    });
  });

  afterAll(async () => {
    await adminDb.optOut.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("sans préférence : ordre de la règle (WhatsApp) ; canal appris SMS : SMS en premier", async () => {
    expect(await picked((await customer({ phone: "+2250701000001" })).id)).toBe("WHATSAPP");
    expect(await picked((await customer({ phone: "+2250701000002", bestChannel: "SMS" })).id)).toBe(
      "SMS",
    );
  });

  it("le choix manuel prime ; numéro non WhatsApp : WhatsApp jamais avancé", async () => {
    expect(
      await picked(
        (
          await customer({
            phone: "+2250701000003",
            bestChannel: "SMS",
            preferredChannel: "WHATSAPP",
          })
        ).id,
      ),
    ).toBe("WHATSAPP");
    const notOnWhatsapp = await customer({
      phone: "+2250701000004",
      bestChannel: "WHATSAPP",
      hasWhatsapp: false,
    });
    const tenantDb = db.forTenant({ organizationId: org.id });
    const recipient = await resolveRecipient(tenantDb, notOnWhatsapp, "INSPECTION");
    const { candidates } = await resolveChannelCandidates(tenantDb, recipient!, [
      "SMS",
      "WHATSAPP",
    ]);
    expect(candidates.map((c) => c.channel)).toEqual(["SMS", "WHATSAPP"]);
  });

  it("OptOut sur le canal appris : repli sur le canal suivant de la règle", async () => {
    const c = await customer({ phone: "+2250701000005", bestChannel: "SMS" });
    await adminDb.optOut.create({
      data: { organizationId: org.id, address: "+2250701000005", channel: "SMS", source: "staff" },
    });
    expect(await picked(c.id)).toBe("WHATSAPP");
  });

  it("optimisation désactivée (settings.ai) : canal appris ignoré", async () => {
    await adminDb.organization.update({
      where: { id: org.id },
      data: { settings: { ai: { autoTimeOptimization: false } } },
    });
    try {
      expect(
        await picked((await customer({ phone: "+2250701000006", bestChannel: "SMS" })).id),
      ).toBe("WHATSAPP");
    } finally {
      await adminDb.organization.update({ where: { id: org.id }, data: { settings: {} } });
    }
  });
});
