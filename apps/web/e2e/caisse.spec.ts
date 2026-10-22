import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M08 — parcours caisse et clôture sur mobile 390 px : ouverture → encaissements (espèces +
// Wave) → dépense sous le seuil → dépense au-delà du seuil en attente (clôture bloquée) →
// validation par la gérante → versement banque → clôture avec écart commenté → historique,
// écart validé, Z de caisse (PDF).

test.use({ viewport: { width: 390, height: 844 } });

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

async function loggedIn(
  browser: Browser,
  organizationId: string,
  role: "OWNER" | "CASHIER",
  name: string,
) {
  const user = await adminDb.user.create({
    data: { name, email: `e2e-caisse-${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return { page, membershipId: membership.id, context };
}

test("parcours caisse : dépenses validées, versement, clôture avec écart, Z de caisse", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Caisse ${randomBytes(3).toString("hex")}`,
      legalName: "Garage Caisse SARL",
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const owner = await loggedIn(browser, organization.id, "OWNER", "E2E Gérante");
  const cashier = await loggedIn(browser, organization.id, "CASHIER", "E2E Caissière");
  const page = cashier.page;

  // ── Ouverture de la caisse ──
  await page.goto("/caisse");
  await typeAmount(page, "Fond de caisse", "50000");
  await page.getByRole("button", { name: "Ouvrir la caisse" }).click();
  await expect(page.getByTestId("expected-cash")).toHaveText("50 000 FCFA");
  await noHorizontalScroll(page);

  // Encaissements de la journée (le parcours d'encaissement est couvert par factures.spec).
  const session = await adminDb.cashSession.findFirstOrThrow({
    where: { organizationId: organization.id, closedAt: null },
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
        cashSessionId: session.id,
        receivedById: cashier.membershipId,
      },
    });
  }
  await page.reload();
  await expect(page.getByTestId("expected-cash")).toHaveText("150 000 FCFA");
  await expect(page.getByTestId("method-totals")).toContainText("Wave");

  // ── Dépense sous le seuil : sort de la caisse ──
  await page.getByRole("button", { name: "Nouvelle dépense" }).click();
  let dialog = page.getByRole("dialog", { name: "Enregistrer une dépense" });
  await dialog.getByLabel("Catégorie").selectOption("Carburant");
  await typeAmount(page, "Montant", "12500", dialog);
  await dialog.getByLabel("Description").fill("Essai routier");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Dépense enregistrée.")).toBeVisible();
  await expect(page.getByTestId("expected-cash")).toHaveText("137 500 FCFA");

  // ── Dépense au-delà du seuil (25 000) : en attente, clôture bloquée ──
  await page.getByRole("button", { name: "Nouvelle dépense" }).click();
  dialog = page.getByRole("dialog", { name: "Enregistrer une dépense" });
  await dialog.getByLabel("Catégorie").selectOption("Transport");
  await typeAmount(page, "Montant", "40000", dialog);
  await dialog.getByLabel("Description").fill("Remorquage véhicule client");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Dépense envoyée en validation au gérant.")).toBeVisible();
  await expect(page.getByText(/1 dépense\(s\) en attente de validation/)).toBeVisible();
  await expect(page.getByTestId("expected-cash")).toHaveText("137 500 FCFA");
  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  dialog = page.getByRole("dialog", { name: "Clôturer la caisse" });
  await expect(dialog.getByText(/Clôture impossible/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clôturer" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await noHorizontalScroll(page);

  // ── La gérante valide la dépense en attente ──
  await owner.page.goto("/caisse/depenses?status=PENDING");
  const list = owner.page.getByTestId("expense-list");
  await expect(list).toContainText("Remorquage véhicule client");
  await list.getByRole("button", { name: "Valider" }).click();
  const decide = owner.page.getByRole("dialog", { name: "Valider la dépense" });
  await decide.getByRole("button", { name: "Valider" }).click();
  await expect(owner.page.getByText("Dépense validée.")).toBeVisible();
  await noHorizontalScroll(owner.page);

  // ── Versement en banque puis clôture avec écart commenté ──
  await page.reload();
  await expect(page.getByTestId("expected-cash")).toHaveText("97 500 FCFA");
  await page.getByRole("button", { name: "Versement coffre / banque" }).click();
  dialog = page.getByRole("dialog", { name: "Versement" });
  await typeAmount(page, "Montant", "20000", dialog);
  // M18 : le versement arrive sur un compte de trésorerie (coffre créé par défaut).
  await dialog.getByRole("radio", { name: "Coffre" }).click();
  await dialog.getByLabel("Référence (bordereau)").fill("BV-0042");
  await dialog.getByRole("button", { name: "Enregistrer le versement" }).click();
  await expect(page.getByTestId("expected-cash")).toHaveText("77 500 FCFA");
  await expect(page.getByTestId("cash-journal")).toContainText("BV-0042");

  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  dialog = page.getByRole("dialog", { name: "Clôturer la caisse" });
  await typeAmount(page, "Montant compté", "77000", dialog);
  await expect(dialog.getByTestId("close-difference")).toContainText("Manquant de −500 FCFA");
  await expect(dialog.getByRole("button", { name: "Clôturer" })).toBeDisabled();
  await dialog.locator("textarea").fill("Pièce de 500 introuvable");
  await dialog.getByRole("button", { name: "Clôturer" }).click();
  await expect(page.getByText(/Caisse clôturée/)).toBeVisible();
  await expect(page.getByText("Aucune caisse ouverte sur ce site.")).toBeVisible();
  await noHorizontalScroll(page);

  // ── Historique : écart à valider, validation, Z de caisse ──
  await owner.page.goto("/caisse/sessions");
  await owner.page.getByLabel("Statut").selectOption("to_review");
  const sessions = owner.page.getByTestId("session-list");
  await expect(sessions).toContainText("−500 FCFA");
  await expect(owner.page.getByTestId("variance-by-cashier")).toContainText("E2E Caissière");
  await sessions.getByRole("button", { name: "Valider l'écart" }).click();
  const review = owner.page.getByRole("dialog", { name: "Valider l'écart" });
  await review.getByLabel("Commentaire de validation").fill("Écart accepté, rendu monnaie");
  await review.getByRole("button", { name: "Valider l'écart" }).click();
  await expect(owner.page.getByText("Écart validé.")).toBeVisible();
  await noHorizontalScroll(owner.page);

  await owner.page.goto(`/caisse/sessions/${session.id}`, { timeout: 30_000 });
  await expect(owner.page.getByTestId("session-difference")).toHaveText("−500 FCFA");
  await expect(owner.page.getByText(/Validé par E2E Gérante/)).toBeVisible();
  await noHorizontalScroll(owner.page);
  const z = await owner.page.request.get(`/api/caisse/sessions/${session.id}/z`);
  expect(z.status()).toBe(200);
  expect(z.headers()["content-type"]).toBe("application/pdf");

  await owner.context.close();
  await cashier.context.close();
});
