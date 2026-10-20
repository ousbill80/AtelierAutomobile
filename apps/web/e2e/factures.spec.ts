import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M08 §12 (périmètre 4.1) — parcours principal sur mobile 390 px : OR prêt → « Facturer » →
// émission FAC-2026-000001 → ouverture de caisse → encaissement 30 000 espèces (reçu) → solde
// payé par Wave saisi à la main (référence) → facture « Payée » → espèces attendues en caisse.

test.use({ viewport: { width: 390, height: 844 } });

/** MoneyInput reformate au focus : on remplace tout le contenu au clavier. */
async function typeAmount(
  page: Page,
  label: string,
  value: string,
  scope?: ReturnType<Page["getByRole"]>,
) {
  const input = (scope ?? page).getByLabel(label);
  await input.click();
  await input.press("Control+A");
  await input.pressSequentially(value);
  await input.blur();
}

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

// Le serveur E2E tourne sur l'horloge réelle : l'année des numéros fiscaux est celle du jour (Abidjan = UTC).
const YEAR = new Date().getUTCFullYear();

test("parcours facturation : OR prêt → facture émise → espèces + Wave → reçu", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Facturation ${randomBytes(3).toString("hex")}`,
      legalName: "Garage Facturation SARL",
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
    data: { name: "E2E Gérante", email: `e2e-fact-${randomBytes(4).toString("hex")}@example.com` },
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
    },
  });
  const suffix = String(1000 + Math.floor(Math.random() * 8999));
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: `${suffix} GH 01`,
      plateCompact: `${suffix}GH01`,
      make: "Toyota",
      model: "Corolla",
    },
  });
  const oil = await adminDb.product.create({
    data: {
      organizationId: organization.id,
      sku: "HUILE-5W30",
      name: "Huile 5W30 (L)",
      unit: "litre",
      quantityScale: 10,
      salePrice: 6_350,
      averageCost: 4_100,
    },
  });
  await adminDb.stockLevel.create({
    data: { organizationId: organization.id, siteId: site.id, productId: oil.id, onHand: 100 },
  });
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "READY",
      mileageIn: 84_500,
      readyAt: new Date(),
    },
  });
  await adminDb.repairOrderLine.createMany({
    data: [
      {
        organizationId: organization.id,
        repairOrderId: order.id,
        type: "LABOR",
        description: "MO Vidange moteur",
        quantity: 1,
        unitPrice: 15_000,
        vatRate: 18,
        status: "DONE",
        approval: "APPROVED",
        sortOrder: 0,
      },
      {
        organizationId: organization.id,
        repairOrderId: order.id,
        type: "PART",
        productId: oil.id,
        description: "Huile 5W30 (L)",
        quantity: 4.5,
        unitPrice: 6_350,
        vatRate: 18,
        status: "DONE",
        approval: "APPROVED",
        sortOrder: 1,
      },
    ],
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  // ── OR prêt → « Facturer » : brouillon avec les lignes de l'OR ──
  await page.goto(`/ordres/${order.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Facturer", exact: true }).click();
  await expect(page).toHaveURL(/\/factures\/[^/]+$/, { timeout: 20_000 });
  const invoiceUrl = page.url();
  await expect(page.getByTestId("invoice-number")).toHaveText("Brouillon");
  // 17 700 + 33 719 (RG-M08-06).
  await expect(page.getByTestId("invoice-total")).toContainText("51 419 FCFA");
  await noHorizontalScroll(page);

  // ── Émission : numéro définitif, FNE en attente ──
  await page.getByRole("button", { name: "Émettre", exact: true }).click();
  await page.getByRole("button", { name: "Émettre la facture" }).click();
  await expect(page.getByTestId("invoice-number")).toHaveText(`FAC-${YEAR}-000001`);
  await expect(page.getByText("⚠ FNE en attente", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  // ── Caisse fermée : l'espèce est refusée, ouverture de la caisse ──
  await page.getByRole("button", { name: "Encaisser", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Encaisser" });
  await typeAmount(page, "Montant reçu", "30000", dialog);
  await dialog.getByRole("button", { name: "Valider l'encaissement" }).click();
  await expect(dialog.getByText("Ouvrez la caisse pour encaisser en espèces.")).toBeVisible();
  await dialog.getByRole("link", { name: "Ouvrir la caisse" }).click();
  await expect(page).toHaveURL(/\/caisse$/);
  await typeAmount(page, "Fond de caisse", "50000");
  await page.getByRole("button", { name: "Ouvrir la caisse" }).click();
  await expect(page.getByTestId("expected-cash")).toHaveText("50 000 FCFA");
  await noHorizontalScroll(page);

  // ── Encaissement partiel espèces 30 000 → reçu REC-2026-000001 ──
  await page.goto(invoiceUrl);
  await page.getByRole("button", { name: "Encaisser", exact: true }).click();
  await dialog.getByRole("button", { name: "Espèces" }).click();
  await typeAmount(page, "Montant reçu", "30000", dialog);
  await dialog.getByRole("button", { name: "Valider l'encaissement" }).click();
  await expect(dialog.getByText(`Paiement REC-${YEAR}-000001 enregistré.`)).toBeVisible();
  const receipt = dialog.getByRole("link", { name: /Imprimer le reçu/ });
  const receiptHref = await receipt.getAttribute("href");
  const pdf = await page.request.get(receiptHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await noHorizontalScroll(page);
  await dialog.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByTestId("invoice-balance")).toContainText("21 419 FCFA");
  await expect(page.getByText("Partiellement payée")).toBeVisible();

  // ── Solde payé par Wave reçu sur le numéro marchand (saisie manuelle, référence) ──
  await page.getByRole("button", { name: "Encaisser", exact: true }).click();
  await dialog.getByRole("button", { name: "Wave" }).click();
  await dialog.getByLabel("Référence").fill("T_8F2A91");
  await dialog.getByRole("button", { name: "Valider l'encaissement" }).click();
  await expect(dialog.getByText(`Paiement REC-${YEAR}-000002 enregistré.`)).toBeVisible();
  await dialog.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByTestId("invoice-balance")).toContainText("0 FCFA");
  await expect(page.getByText("Payée", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  // ── Facture PDF et caisse : 50 000 + 30 000 espèces attendues ──
  const invoicePdf = await page.request.get(
    `/api/factures/${invoiceUrl.split("/factures/")[1]}/pdf`,
  );
  expect(invoicePdf.status()).toBe(200);
  await page.goto("/caisse");
  await expect(page.getByTestId("expected-cash")).toHaveText("80 000 FCFA");
  await noHorizontalScroll(page);

  // ── Liste des factures ──
  await page.goto("/factures");
  await expect(page.getByText(`FAC-${YEAR}-000001`)).toBeVisible();
  await noHorizontalScroll(page);
  await context.close();
});
