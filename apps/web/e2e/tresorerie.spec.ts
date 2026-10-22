import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M18 — parcours trésorerie sur mobile 390 px : encaissement Wave non rattaché → création du
// compte Wave → compte bancaire → virement caisse → banque → dépense hors caisse → rapprochement
// juste → journal → rapport et export CSV.

test.use({ viewport: { width: 390, height: 844 } });

/** Premier affichage d'une page (compilation à la volée en dev, projection du grand livre). */
const FIRST_LOAD = { timeout: 20_000 };

async function typeAmount(
  page: Page,
  label: string,
  value: string,
  scope?: ReturnType<Page["getByRole"]>,
) {
  const input = (scope ?? page).getByLabel(label, { exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially(value);
  await input.blur();
}

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

test("parcours trésorerie : comptes, virement, dépense, rapprochement, rapport", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Trésorerie ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Gérante",
      email: `e2e-treso-${randomBytes(4).toString("hex")}@example.com`,
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
  for (const [method, amount, reference] of [
    ["CASH", 100_000, null],
    ["WAVE", 85_000, `T_${randomBytes(3).toString("hex")}`],
  ] as const) {
    await adminDb.payment.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        number: `REC-E2E-${randomBytes(3).toString("hex")}`,
        method,
        amount,
        reference,
        receivedAt: new Date(),
      },
    });
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  // ── Vue d'ensemble : caisse créée, Wave non rattaché ──
  await page.goto("/tresorerie");
  await expect(page.getByTestId("treasury-total")).toHaveText("100 000 FCFA", FIRST_LOAD);
  await expect(page.getByTestId("treasury-alerts")).toContainText("Wave");
  await noHorizontalScroll(page);

  // ── Compte Wave ──
  await page.getByRole("button", { name: "Nouveau compte" }).click();
  let dialog = page.getByRole("dialog", { name: "Nouveau compte de trésorerie" });
  await dialog.getByLabel("Nom du compte").fill("Wave marchand");
  await dialog.getByLabel("Type").selectOption("MOBILE_MONEY");
  await dialog.getByRole("checkbox", { name: "Wave" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Compte créé.")).toBeVisible();
  await expect(page.getByTestId("treasury-total")).toHaveText("185 000 FCFA");
  await expect(page.getByTestId("treasury-alerts")).toHaveCount(0);

  // ── Compte bancaire avec solde d'ouverture ──
  await page.getByRole("button", { name: "Nouveau compte" }).click();
  dialog = page.getByRole("dialog", { name: "Nouveau compte de trésorerie" });
  await dialog.getByLabel("Nom du compte").fill("SGBCI");
  await typeAmount(page, "Solde d'ouverture", "1000000", dialog);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("treasury-total")).toHaveText("1 185 000 FCFA");

  // ── Virement caisse → banque ──
  await page.getByRole("button", { name: "Virement", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Virement entre comptes" });
  await dialog.getByLabel("Depuis").selectOption({ label: "Caisse Yopougon — 100 000 FCFA" });
  await dialog.getByLabel("Vers").selectOption({ label: "SGBCI — 1 000 000 FCFA" });
  await typeAmount(page, "Montant", "50000", dialog);
  await dialog.getByLabel("Référence (bordereau, chèque…)").fill("BV-0042");
  await dialog.getByRole("button", { name: "Virement" }).click();
  await expect(page.getByText("Virement enregistré.")).toBeVisible();
  await expect(page.getByTestId("balance-SGBCI")).toHaveText("1 050 000 FCFA");
  await expect(page.getByTestId("treasury-total")).toHaveText("1 185 000 FCFA");

  // ── Dépense hors caisse payée par la banque ──
  await page.getByRole("button", { name: "Dépense", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Dépense hors caisse" });
  await dialog.getByLabel("Payée depuis").selectOption({ label: "SGBCI — 1 050 000 FCFA" });
  await dialog.getByLabel("Catégorie").selectOption("Frais bancaires");
  await typeAmount(page, "Montant", "20000", dialog);
  await dialog.getByLabel("Description").fill("Frais de tenue de compte");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Dépense enregistrée.")).toBeVisible();
  await expect(page.getByTestId("balance-SGBCI")).toHaveText("1 030 000 FCFA");
  await noHorizontalScroll(page);

  // ── Rapprochement : relevé égal au solde calculé ──
  await page.getByTestId("treasury-accounts").getByRole("link", { name: /SGBCI/ }).click();
  await expect(page.getByTestId("account-balance")).toHaveText("1 030 000 FCFA", FIRST_LOAD);
  await page.getByRole("button", { name: "Rapprocher" }).click();
  dialog = page.getByRole("dialog", { name: /Rapprocher avec un relevé/ });
  await typeAmount(page, "Solde du relevé", "1030000", dialog);
  await dialog.getByRole("button", { name: "Rapprocher" }).click();
  await expect(page.getByText("Rapprochement enregistré.")).toBeVisible();
  await expect(page.getByTestId("reconciliations")).toContainText("1 030 000 FCFA");
  await noHorizontalScroll(page);

  // ── Journal : recherche par référence (les deux jambes du virement) ──
  await page.goto("/tresorerie/journal");
  await page.getByLabel("Rechercher (libellé, référence, catégorie)").fill("BV-0042", FIRST_LOAD);
  await expect(page.getByTestId("treasury-journal").locator("li")).toHaveCount(2, FIRST_LOAD);
  await noHorizontalScroll(page);

  // ── Rapport du mois et export CSV ──
  await page.goto("/tresorerie/rapports");
  await expect(page.getByTestId("report-closing")).toHaveText("1 165 000 FCFA", FIRST_LOAD);
  await noHorizontalScroll(page);
  const csv = await page.request.get((await page.getByTestId("export-csv").getAttribute("href"))!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Solde de clôture");

  await context.close();
});
