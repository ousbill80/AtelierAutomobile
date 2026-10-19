import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// §12 — parcours principal M10 (file du jour) : une relance « à valider » apparaît dans
// /relances, peut être envoyée immédiatement, et une autre peut être ignorée avec un motif.
// Le passage plan → dispatch réel dépend de files répétables (BullMQ, cadence horaire/5 min,
// cf. apps/worker/src/queues/reminders.ts) trop lentes à attendre dans un test E2E : les
// relances sont ici créées directement en base (comme le ferait reminders.plan), pour tester
// les actions utilisateur de l'écran plutôt que la planification elle-même (déjà couverte par
// les tests d'intégration de apps/worker/src/jobs/reminders.test.ts).

async function createSignedInContext(browserContext: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: { name: `E2E Garage Relances ${randomBytes(3).toString("hex")}` },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Owner",
      email: `e2e-relances-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
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
  return { organization };
}

test("parcours file du jour : envoyer une relance, en ignorer une autre avec motif", async ({
  page,
  context,
}) => {
  const { organization } = await createSignedInContext(context);

  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      type: "INDIVIDUAL",
      phone: `+225${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 10)}`,
      whatsappPhone: null,
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: "2547 GH 01",
      make: "Toyota",
      model: "Corolla",
      inspectionExpiryDate: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "INSPECTION",
      name: "Visite technique",
      isActive: true,
      steps: [
        {
          key: "J-30",
          label: "1er rappel",
          offsetDays: -30,
          templateKey: "vt_j30",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: {
        days: [0, 1, 2, 3, 4, 5, 6],
        from: "00:00",
        to: "23:59",
        preferredTime: "09:00",
      },
      conditions: {},
      stopOn: [],
    },
  });
  await adminDb.messageTemplate.create({
    data: {
      organizationId: organization.id,
      key: "vt_j30",
      name: "VT — J-30",
      channel: "WHATSAPP",
      body: "Bonjour {{client.salutation}}, VT {{vehicule.plaque}} expire le {{vt.dateExpiration}}.",
      isActive: true,
    },
  });

  const toSend = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "INSPECTION",
      stepKey: "J-30",
      customerId: customer.id,
      vehicleId: vehicle.id,
      dueDate: vehicle.inspectionExpiryDate!,
      scheduledFor: new Date(),
      status: "NEEDS_APPROVAL",
      channel: "WHATSAPP",
      dedupeKey: "INSPECTION:e2e-1:J-30",
      sequenceKey: "INSPECTION:e2e-1",
    },
  });
  const toSkip = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "INSPECTION",
      stepKey: "J-30",
      customerId: customer.id,
      vehicleId: vehicle.id,
      dueDate: vehicle.inspectionExpiryDate!,
      scheduledFor: new Date(),
      status: "NEEDS_APPROVAL",
      channel: "WHATSAPP",
      dedupeKey: "INSPECTION:e2e-2:J-30",
      sequenceKey: "INSPECTION:e2e-2",
    },
  });

  await page.goto("/relances");
  await expect(page.getByRole("button", { name: /À valider/ })).toBeVisible();
  await expect(page.getByText("Kouassi Jean-Marc").first()).toBeVisible();
  await expect(page.getByText("2547 GH 01").first()).toBeVisible();

  const bothIds = [toSend.id, toSkip.id];

  // Envoyer la première relance affichée (l'ordre des deux cartes n'est pas garanti).
  await page.getByRole("button", { name: "Envoyer", exact: true }).first().click();
  let approvedId = "";
  await expect(async () => {
    const reminders = await adminDb.reminder.findMany({ where: { id: { in: bothIds } } });
    const approved = reminders.find((r) => r.status === "PLANNED" || r.status === "QUEUED");
    expect(approved).toBeDefined();
    approvedId = approved!.id;
  }).toPass({ timeout: 10_000 });
  const remainingId = bothIds.find((id) => id !== approvedId)!;

  // Ignorer la relance restante avec un motif, en arrêtant sa séquence.
  await page.reload();
  await page.getByRole("button", { name: "Ignorer" }).first().click();
  // Les deux premiers <select> de la page sont les filtres (type, canal) : le formulaire
  // d'abandon de la carte est le dernier combobox une fois une seule carte affichée.
  await page.getByRole("combobox").last().selectOption("Client vendu le véhicule");
  await page.getByLabel("Arrêter la séquence").check();
  await page.getByRole("button", { name: "Confirmer" }).click();

  await expect(async () => {
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: remainingId } });
    expect(updated.status).toBe("SKIPPED");
    expect(updated.skippedReason).toBe("Client vendu le véhicule");
  }).toPass({ timeout: 10_000 });

  const remainingSequenceKey = remainingId === toSend.id ? "INSPECTION:e2e-1" : "INSPECTION:e2e-2";
  const suppression = await adminDb.reminderSuppression.findFirst({
    where: { organizationId: organization.id, sequenceKey: remainingSequenceKey },
  });
  expect(suppression).not.toBeNull();
});
