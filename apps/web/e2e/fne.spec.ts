import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M08 §FNE (étape 4.2) — parcours principal sur mobile 390 px : facture émise → certification
// FNE (mode manuel : saisie du numéro et du QR ; mode API : simulateur, certifiée par le worker)
// → PDF de la facture avec bloc FNE.

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

/** Organisation, gérante connectée et facture brouillon d'une ligne (onboarding terminé). */
async function setup(browser: Browser, label: string) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage FNE ${label} ${randomBytes(3).toString("hex")}`,
      legalName: "Garage FNE SARL",
      rccm: "CI-ABJ-2019-B-12345",
      ncc: "1912345A",
      address: "Yopougon, Abidjan",
      phone: "+2252722000000",
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérante", email: `e2e-fne-${randomBytes(4).toString("hex")}@example.com` },
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
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      phone: "+2250707070707",
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
      description: "Diagnostic électronique",
      quantity: 1,
      unitPrice: 20_000,
      vatRate: 18,
      // Recalculés à l'émission (persistTotals).
      lineSubtotal: 20_000,
      lineVat: 3_600,
      lineTotal: 23_600,
    },
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return { organization, draft, page };
}

async function issue(page: Page, invoiceId: string) {
  await page.goto(`/factures/${invoiceId}`);
  await page.getByRole("button", { name: "Émettre", exact: true }).click();
  await page.getByRole("button", { name: "Émettre la facture" }).click();
  await expect(page.getByTestId("invoice-number")).toHaveText(/^FAC-\d{4}-000001$/);
}

async function expectPdf(page: Page, invoiceId: string) {
  const pdf = await page.request.get(`/api/factures/${invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
}

test("FNE manuelle : facture émise → saisie du numéro et du QR → certifiée, PDF", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { draft, page } = await setup(browser, "manuel");

  await issue(page, draft.id);
  const panel = page.getByTestId("fne-panel");
  await expect(panel).toContainText("FNE en attente de certification");
  await expect(page.getByText("⚠ FNE en attente", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  // Liste : filtre « Non certifiées ».
  await page.goto("/factures");
  await page.getByRole("button", { name: /Non certifiées \(1\)/ }).click();
  await expect(page.getByText(/FAC-\d{4}-000001/).first()).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto(`/factures/${draft.id}`);
  await panel.getByRole("button", { name: "Saisir le numéro FNE" }).click();
  const dialog = page.getByRole("dialog", { name: "Saisir la FNE obtenue sur la plateforme DGI" });
  await dialog.getByLabel("Numéro FNE").fill("FNE-2026-0004512");
  await dialog
    .getByLabel("Contenu du QR code (lien ou texte décodé)")
    .fill("https://fne.dgi.gouv.ci/verification/FNE-2026-0004512");
  await noHorizontalScroll(page);
  await dialog.getByRole("button", { name: "Enregistrer la FNE" }).click();
  await expect(page.getByTestId("fne-number")).toHaveText("FNE-2026-0004512");
  await expect(page.getByText("✓ FNE saisie", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  await expectPdf(page, draft.id);
});

test("FNE API (simulateur) : paramétrage → émission → certifiée par le worker, PDF", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { draft, page } = await setup(browser, "api");

  await page.goto("/parametres/fne");
  await page.getByLabel("API : certification automatique à l'émission").check();
  await page.getByLabel("Service de certification").selectOption("fake");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("✓ Paramètres FNE enregistrés.")).toBeVisible();
  await page.getByRole("button", { name: "Tester la certification" }).click();
  await expect(page.getByRole("status")).toContainText("Simulateur FNE");
  await noHorizontalScroll(page);

  await issue(page, draft.id);
  // Job `fne.certify` traité par apps/worker juste après l'émission.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("fne-number")).toHaveText(/^SIM-FAC-\d{4}-000001$/, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });
  await expect(page.getByText("✓ Certifiée FNE", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  await expectPdf(page, draft.id);
});
