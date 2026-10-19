import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { SESSION_COOKIE_NAME } from "../src/server/session-cookie-name";

/**
 * Parcours principal du moteur de relances (M10) : une relance « visite technique » en
 * attente d'approbation apparaît dans la file, le gérant l'approuve depuis l'écran
 * « Relances du jour », et elle passe en statut Envoyée (RG-M10-24, RG-M10-31).
 *
 * La connexion passe par l'injection directe d'une session valide (plutôt que par le
 * formulaire de connexion) : ce test porte sur le moteur de relances, pas sur l'authentification
 * (déjà couverte par `garage-onboarding-permissions.spec.ts`).
 */
test("approuver une relance de visite technique depuis la file « Relances du jour »", async ({
  page,
}) => {
  const unique = randomBytes(4).toString("hex");

  const org = await adminDb.organization.create({
    data: { name: `Garage E2E Relances ${unique}`, onboardingCompletedAt: new Date() },
  });
  const user = await adminDb.user.create({
    data: { name: "Gérant E2E Relances", email: `gerant-relances-${unique}@test.atelieros.local` },
  });
  await adminDb.membership.create({
    data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: org.id,
      isPinSession: false,
    },
  });

  await adminDb.site.create({
    data: {
      organizationId: org.id,
      name: "Atelier E2E",
      code: `E2E${unique.slice(0, 4)}`,
      phone: "+2250700000077",
    },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: org.id,
      displayName: "Diallo Fatou",
      civility: "MME",
      lastName: "Diallo",
      phone: "+2250700000055",
      whatsappPhone: "+2250700000055",
      hasWhatsapp: true,
      remindersConsent: true,
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: org.id,
      customerId: customer.id,
      plate: `E2E${unique.slice(0, 4)}`,
      make: "Toyota",
      model: "Corolla",
      inspectionExpiryDate: new Date(Date.now() + 5 * 86_400_000),
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: org.id,
      type: "INSPECTION",
      name: "VT — E2E",
      steps: [
        {
          key: "J-5",
          label: "J-5",
          offsetDays: -5,
          templateKey: "vt_j5_e2e",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00", preferredTime: "09:00" },
      stopOn: [],
    },
  });
  await adminDb.messageTemplate.create({
    data: {
      organizationId: org.id,
      key: "vt_j5_e2e",
      name: "VT J-5 E2E",
      channel: "WHATSAPP",
      body: "Bonjour {{client.salutation}}, votre VT expire bientôt.",
    },
  });
  const reminder = await adminDb.reminder.create({
    data: {
      organizationId: org.id,
      ruleId: rule.id,
      type: "INSPECTION",
      stepKey: "J-5",
      customerId: customer.id,
      vehicleId: vehicle.id,
      dueDate: vehicle.inspectionExpiryDate!,
      scheduledFor: new Date(),
      status: "NEEDS_APPROVAL",
      channel: "WHATSAPP",
      dedupeKey: `INSPECTION:${vehicle.id}:e2e:J-5`,
      sequenceKey: `INSPECTION:${vehicle.id}:e2e`,
    },
  });

  try {
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/relances");
    await expect(page.getByRole("heading", { name: "Relances du jour" })).toBeVisible();
    await expect(page.getByText("Diallo Fatou").first()).toBeVisible();

    const row = page.locator("tr", { hasText: "Diallo Fatou" });
    await row.getByRole("checkbox").check();

    await page.getByRole("button", { name: /Approuver/ }).click();

    await expect(page.getByText("Diallo Fatou")).toHaveCount(0);

    await expect
      .poll(async () => {
        const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
        return updated.status;
      })
      .toBe("SENT");
  } finally {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminder.deleteMany({ where: { organizationId: org.id } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: org.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.site.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: user.id } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: user.id } });
    await adminDb.organization.deleteMany({ where: { id: org.id } });
  }
});
