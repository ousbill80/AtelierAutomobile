import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M17 §12 — parcours principal des automatisations : activer le modèle fourni « OR prêt →
// message + lien de paiement », passer un OR à Prêt → le message (avec lien) est visible dans
// /dev/outbox (traité par apps/worker : `automations.dispatch` puis `messages.send`), et
// l'exécution apparaît dans l'historique.

test("automatisation « OR prêt » : activation en un clic, OR passé à Prêt, message envoyé", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Automatisations ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
      // Sans contrôle qualité : « Terminer » fait passer l'OR directement à Prêt (M04 §5).
      settings: { repairOrders: { qcRequired: false } },
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Gérant",
      email: `e2e-auto-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
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
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
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
  // Numéro unique par exécution : /dev/outbox liste les messages de toutes les organisations.
  const phone = `+22507${randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 8)}`;
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      lastName: "Kouassi",
      civility: "M",
      phone,
    },
  });
  const plateSuffix = String(1000 + Math.floor(Math.random() * 8999));
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: `${plateSuffix} GH 01`,
      plateCompact: `${plateSuffix}GH01`,
      make: "Toyota",
      model: "Corolla",
    },
  });
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "IN_PROGRESS",
      mileageIn: 24_100,
      totalEstimate: 185_000,
    },
  });
  await adminDb.repairOrderLine.create({
    data: {
      organizationId: organization.id,
      repairOrderId: order.id,
      type: "LABOR",
      description: "Remplacement plaquettes AV",
      quantity: 1,
      unitPrice: 15_000,
      vatRate: 18,
      status: "DONE",
      approval: "APPROVED",
      sortOrder: 0,
    },
  });

  // 1. Activer le modèle fourni en un clic.
  await page.goto("/parametres/automatisations");
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("automation-template-ro_ready_message");
  await card.getByRole("button", { name: "Activer" }).click();
  await expect(card.getByText("Activé")).toBeVisible();
  await expect(page.getByText("OR prêt → message + lien de paiement").nth(1)).toBeVisible();

  // 2. Passer l'OR à Prêt.
  await page.goto(`/ordres/${order.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Terminer les travaux" }).click();
  await expect
    .poll(async () => (await adminDb.repairOrder.findUnique({ where: { id: order.id } }))?.status)
    .toBe("READY");

  // 3. Le message part via M11 (worker) et apparaît dans /dev/outbox, avec un lien.
  const entry = page.getByTestId(`outbox-entry-WHATSAPP-${phone}`);
  await page.goto("/dev/outbox");
  await expect(async () => {
    await page.reload();
    await expect(entry).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000, intervals: [2000] });
  await expect(entry).toContainText("est prêt");
  await expect(entry).toContainText("/p/");

  const run = await adminDb.automationRun.findFirst({
    where: { organizationId: organization.id },
  });
  expect(run?.status).toBe("SUCCEEDED");

  // 4. L'exécution est visible dans l'historique.
  await page.goto("/parametres/automatisations");
  await expect(page.getByText("Réussie").first()).toBeVisible();
});
