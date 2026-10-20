import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M17 §12 — parcours principal (fournisseur IA `console`, sans clé) : message entrant
// « oui samedi matin » en réponse à une relance VT → badge « Veut un RDV » → choisir le créneau
// proposé → RDV créé (source WhatsApp, relance d'origine) → relance VT suivante arrêtée.

const HOURS = {
  mon: [["07:00", "18:00"]],
  tue: [["07:00", "18:00"]],
  wed: [["07:00", "18:00"]],
  thu: [["07:00", "18:00"]],
  fri: [["07:00", "18:00"]],
  sat: [["07:00", "18:00"]],
  sun: [],
};

async function setup(browserContext: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage IA ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant IA", email: `e2e-ia-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP", openingHours: HOURS },
  });
  await adminDb.bay.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      name: "Pont 1",
      type: "LIFT",
      sortOrder: 1,
    },
  });
  await adminDb.channelConfig.create({
    data: {
      organizationId: organization.id,
      channel: "WHATSAPP",
      provider: "console",
      isActive: true,
      priority: 1,
      credentials: "",
    },
  });
  // Numéro unique : /dev/outbox est partagé entre organisations (RG-M11-26).
  const phone = `+22507${randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 8)}`;
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      lastName: "Kouassi",
      civility: "M",
      type: "INDIVIDUAL",
      phone,
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: "2547 GH 01",
      plateCompact: "2547GH01",
      make: "Toyota",
      model: "Corolla",
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "INSPECTION",
      name: "Visite technique",
      steps: [],
      sendWindow: {},
      stopOn: ["appointment.created"],
    },
  });
  const due = new Date(Date.now() + 30 * 86_400_000);
  const sent = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "INSPECTION",
      stepKey: "J-30",
      customerId: customer.id,
      vehicleId: vehicle.id,
      dueDate: due,
      scheduledFor: new Date(Date.now() - 3_600_000),
      sentAt: new Date(Date.now() - 3_600_000),
      status: "SENT",
      sequenceKey: `INSPECTION:${vehicle.id}`,
      dedupeKey: `INSPECTION:${vehicle.id}:J-30`,
    },
  });
  const next = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "INSPECTION",
      stepKey: "J-15",
      customerId: customer.id,
      vehicleId: vehicle.id,
      dueDate: due,
      scheduledFor: new Date(Date.now() + 15 * 86_400_000),
      status: "PLANNED",
      sequenceKey: `INSPECTION:${vehicle.id}`,
      dedupeKey: `INSPECTION:${vehicle.id}:J-15`,
    },
  });
  // Message de relance déjà parti (fournisseur console) : le client y répond.
  const providerMessageId = `e2e-ia-${randomBytes(6).toString("hex")}`;
  await adminDb.message.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      reminderId: sent.id,
      direction: "OUTBOUND",
      channel: "WHATSAPP",
      to: phone,
      body: "Votre visite technique (2547 GH 01) expire bientôt. Souhaitez-vous un RDV ?",
      status: "SENT",
      provider: "console",
      providerMessageId,
      kind: "REMINDER",
      sentAt: new Date(Date.now() - 3_600_000),
    },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organization.id,
      isPinSession: false,
    },
  });
  await browserContext.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  return {
    organization,
    customer,
    sentReminderId: sent.id,
    nextReminderId: next.id,
    providerMessageId,
  };
}

test("IA : « oui samedi matin » → Veut un RDV → créneau réservé → relance VT arrêtée", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const { organization, customer, sentReminderId, nextReminderId, providerMessageId } =
    await setup(context);

  // 1. Le client répond à la relance (webhook simulé par /dev/outbox).
  const reply = await page.request.post("/api/trpc/devOutbox.simulateReply", {
    data: { json: { providerMessageId, body: "oui ok pour samedi matin svp" } },
  });
  expect(reply.ok()).toBe(true);

  // 2. Boîte de réception : badge d'intention (icône + texte).
  await page.goto("/messages");
  const row = page.getByRole("link", { name: /Kouassi Jean-Marc/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Veut un RDV")).toBeVisible();

  // 3. Conversation : brouillon proposé et créneaux ; rien n'est parti sans clic.
  await row.click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("oui ok pour samedi matin svp")).toBeVisible();
  const draft = page.getByTestId("reply-suggestion");
  await expect(draft).toContainText("Bonjour M. Kouassi, nous vous proposons samedi");
  await expect(draft).toContainText("Toyota Corolla (2547 GH 01)");
  await expect(draft).toContainText("Proposé par l'assistant");
  expect(
    await adminDb.message.count({
      where: { organizationId: organization.id, direction: "OUTBOUND", kind: "CONVERSATION" },
    }),
  ).toBe(0);

  // 4. Réserver le premier créneau proposé.
  const slots = page.getByTestId("slot-suggestion");
  const first = slots.getByRole("button", { name: /^Réserver samedi/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByText(/Rendez-vous créé : samedi/)).toBeVisible({ timeout: 15_000 });

  const appointment = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId: organization.id, customerId: customer.id },
  });
  expect(appointment.source).toBe("WHATSAPP");
  expect(appointment.reminderId).toBe(sentReminderId);
  expect(appointment.type).toBe("INSPECTION_PREP");
  expect(appointment.startsAt.getUTCDay()).toBe(6);

  // 5. La relance VT suivante est arrêtée par le moteur de relances (worker, toutes les 2 min).
  await expect
    .poll(
      async () =>
        (await adminDb.reminder.findUniqueOrThrow({ where: { id: nextReminderId } })).status,
      { timeout: 180_000, intervals: [5_000] },
    )
    .toBe("CANCELLED");

  // 6. Journal IA : classification et brouillon tracés, décision du créneau enregistrée.
  const features = await adminDb.aiInteraction.findMany({
    where: { organizationId: organization.id },
    select: { feature: true, status: true },
  });
  expect(features).toEqual(
    expect.arrayContaining([
      { feature: "intent_classification", status: "OK" },
      { feature: "reply_draft", status: "OK" },
    ]),
  );
  expect(
    await adminDb.aiSuggestion.count({
      where: { organizationId: organization.id, feature: "slot", status: "ACCEPTED" },
    }),
  ).toBe(1);
});
