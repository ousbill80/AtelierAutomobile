import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// Étape 4.3 (M08 US-M08-09 / US-M08-14, M14 US-M14-03) — parcours principal sur mobile 390 px :
// activation du simulateur de paiement → facture émise → envoi par SMS (lien portail + lien de
// paiement) → page facture du client → « Payer avec Wave » → paiement simulé confirmé par
// webhook signé → « Payé ✓ » sur le portail, facture « Payée » et lien « Payé » au back-office.

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

test("lien de paiement : facture envoyée → paiement Wave simulé → facture payée", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Paiement ${randomBytes(3).toString("hex")}`,
      legalName: "Garage Paiement SARL",
      rccm: "CI-ABJ-2019-B-12345",
      ncc: "1912345A",
      address: "Yopougon, Abidjan",
      phone: "+2252722000000",
      vatEnabled: false,
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-pay-${randomBytes(4).toString("hex")}@example.com` },
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
  await adminDb.channelConfig.create({
    data: {
      organizationId: organization.id,
      channel: "SMS",
      provider: "console",
      isActive: true,
      credentials: "{}",
    },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      phone: "+2250747218890",
      paymentTermsDays: 30,
    },
  });
  const draft = await adminDb.invoice.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      status: "DRAFT",
    },
  });
  await adminDb.invoiceLine.create({
    data: {
      organizationId: organization.id,
      invoiceId: draft.id,
      type: "LABOR",
      description: "Révision complète",
      quantity: 1,
      unitPrice: 85_000,
      vatRate: 0,
      // Recalculés à l'émission (persistTotals).
      lineSubtotal: 85_000,
      lineVat: 0,
      lineTotal: 85_000,
    },
  });

  const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await staff.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await staff.newPage();
  page.setDefaultTimeout(15_000);

  // 1. Paramètres > Paiements : activation du simulateur.
  await page.goto("/parametres/paiements");
  const simulator = page.getByTestId("provider-fake");
  await expect(simulator).toBeVisible();
  await simulator.getByRole("button", { name: "Activer" }).click();
  await expect(simulator.getByText("Actif", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  // 2. Facture émise, puis envoyée par SMS avec lien de paiement.
  await page.goto(`/factures/${draft.id}`);
  await page.getByRole("button", { name: "Émettre", exact: true }).click();
  await page.getByRole("button", { name: "Émettre la facture" }).click();
  await expect(page.getByTestId("invoice-number")).toHaveText(/^FAC-\d{4}-000001$/);
  await page
    .getByRole("button", { name: /Envoyer/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Envoyer la facture au client" });
  await dialog.getByLabel("SMS").check();
  await noHorizontalScroll(page);
  await dialog.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Facture envoyée à +2250747218890");
  await dialog.getByRole("button", { name: "Fermer" }).first().click();
  await expect(page.getByTestId("payment-link")).toHaveCount(1);
  await noHorizontalScroll(page);

  // Le SMS contient le lien portail de la facture.
  const message = await adminDb.message.findFirstOrThrow({
    where: { organizationId: organization.id, idempotencyKey: { startsWith: `inv:${draft.id}` } },
  });
  const portalUrl = message.body.match(/https?:\/\/\S+\/p\/[\w-]+\/facture/)?.[0];
  expect(portalUrl).toBeTruthy();
  const portalPath = new URL(portalUrl!).pathname;

  // 3. Le client ouvre la page facture (sans compte) et paie avec Wave.
  const client = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const portal = await client.newPage();
  portal.setDefaultTimeout(15_000);
  await portal.goto(portalPath);
  await expect(portal.getByTestId("portal-invoice-number")).toContainText(/FAC-\d{4}-000001/);
  await expect(portal.getByTestId("portal-invoice-balance")).toContainText("85 000 FCFA");
  await expect(portal.getByText("Facture en cours de certification.")).toBeVisible();
  await noHorizontalScroll(portal);
  await portal.getByRole("button", { name: "Payer 85 000 FCFA avec Wave" }).click();

  // 4. Page de paiement du simulateur → paiement → retour sur la facture.
  await expect(portal.getByRole("heading", { name: "Simulateur de paiement" })).toBeVisible();
  await noHorizontalScroll(portal);
  await portal.getByRole("button", { name: "Payer 85 000 FCFA" }).click();
  await expect(portal).toHaveURL(new RegExp(`${portalPath}$`));
  await expect(portal.getByTestId("portal-paid")).toContainText("Payé ✓");
  await expect(portal.getByTestId("portal-invoice-balance")).toContainText("0 FCFA");
  await noHorizontalScroll(portal);

  // 5. Back-office : facture payée, lien « Payé », reçu enregistré.
  await page.reload();
  await expect(page.getByText("Payée", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("payment-link").first()).toContainText("Payé");
  await expect(page.getByText(/REC-\d{4}-000001/).first()).toBeVisible();
  await noHorizontalScroll(page);

  await client.close();
  await staff.close();
});
