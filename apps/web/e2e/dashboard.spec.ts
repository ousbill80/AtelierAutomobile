import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M12 §12 — parcours principal (partie 1, étape 2.4) : le gérant ouvre le tableau de bord
// sur mobile (390 px), voit la vue du jour (onglet « Aujourd'hui »), puis ses créances et le
// montant récupéré grâce aux relances, change la période (URL partageable), consulte l'onglet
// Relances, puis touche « Créances en cours ».

test.use({ viewport: { width: 390, height: 844 } });

test("gérant mobile : créances, relances, changement de période", async ({ page, context }) => {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Dashboard ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-dash-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "SOTRA Logistique",
      type: "COMPANY",
      phone: "+2250747219999",
    },
  });
  const invoice = await adminDb.invoice.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      number: "FAC-2026-000412",
      status: "OVERDUE",
      issuedAt: new Date(Date.now() - 50 * 86_400_000),
      dueDate: new Date(Date.now() - 40 * 86_400_000),
      total: 1_425_000,
      amountPaid: 185_000,
      balance: 1_240_000,
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "RECEIVABLE",
      name: "Créances",
      isActive: true,
      steps: [],
      sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00", preferredTime: "09:00" },
      conditions: {},
      stopOn: [],
    },
  });
  const reminder = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "RECEIVABLE",
      stepKey: "J+15",
      customerId: customer.id,
      invoiceId: invoice.id,
      dueDate: invoice.dueDate!,
      scheduledFor: new Date(),
      sentAt: new Date(),
      status: "SENT",
      channel: "WHATSAPP",
      outcome: "PARTIALLY_PAID",
      outcomeAt: new Date(),
      attributedAmount: 185_000,
      dedupeKey: `RECEIVABLE:${invoice.id}:J+15`,
    },
  });
  // Paiement Wave alloué à la facture et attribué à la relance (RG-M12-22, PaymentAttribution M09).
  const payment = await adminDb.payment.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      number: "REC-2026-000310",
      method: "WAVE",
      amount: 185_000,
      receivedAt: new Date(),
    },
  });
  const allocation = await adminDb.paymentAllocation.create({
    data: {
      organizationId: organization.id,
      paymentId: payment.id,
      invoiceId: invoice.id,
      amount: 185_000,
    },
  });
  await adminDb.paymentAttribution.create({
    data: {
      organizationId: organization.id,
      paymentAllocationId: allocation.id,
      source: "reminder",
      reminderId: reminder.id,
      amount: 185_000,
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
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);

  await page.goto("/tableau-de-bord");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();

  // Onglet par défaut du gérant : « Aujourd'hui » (vue du jour de l'atelier).
  await expect(page.getByRole("tab", { name: "Aujourd'hui" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByTestId("kpi-card").filter({ hasText: "Encaissé aujourd'hui" }),
  ).toContainText("185 000 FCFA");
  await expect(page.getByTestId("kpi-card").filter({ hasText: "Factures impayées" })).toContainText(
    "1 240 000 FCFA",
  );
  await expect(page.getByText(/Échue depuis \d+ jours/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );

  await page.getByRole("tab", { name: "Synthèse" }).click();
  await expect(page).toHaveURL(/onglet=synthese/);
  const receivablesCard = page.getByRole("link", { name: /Créances en cours/ }).first();
  await expect(receivablesCard).toContainText("1 240 000 FCFA");
  await expect(
    page.getByTestId("kpi-card").filter({ hasText: "Récupéré grâce aux relances" }),
  ).toContainText("185 000 FCFA");

  // Pas de défilement horizontal à 390 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  await page.getByLabel("Période").selectOption({ label: "Mois précédent" });
  await expect(page).toHaveURL(/periode=mois-precedent/);

  await page.getByRole("tab", { name: "Relances" }).click();
  await expect(page).toHaveURL(/onglet=relances/);
  await expect(page.getByTestId("kpi-card").filter({ hasText: "Envoyés" })).toContainText("0");

  await page.getByLabel("Période").selectOption({ label: "Mois en cours" });
  await expect(page.getByTestId("kpi-card").filter({ hasText: "Montant récupéré" })).toContainText(
    "185 000 FCFA",
  );

  await page.getByRole("tab", { name: "Synthèse" }).click();
  await page
    .getByRole("link", { name: /Créances en cours/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/creances\?filtre=en-retard/);
});
