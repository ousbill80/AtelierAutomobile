import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M07 §12 — parcours principal : réception d'une commande partielle (20 filtres à 3 800)
// → CMP 3 688 affiché → réservation pour l'OR de 2547 GH 01 → sortie depuis la file magasin
// → stock et historique corrects → inventaire avec un écart de −1 validé.
// Puis : pas de défilement horizontal à 390 px sur les écrans du module.

async function setup() {
  const suffix = randomBytes(3).toString("hex");
  const organization = await adminDb.organization.create({
    data: { name: `E2E Garage Stock ${suffix}`, onboardingCompletedAt: new Date() },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Gérant Stock",
      email: `e2e-stock-${randomBytes(4).toString("hex")}@example.com`,
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
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const supplier = await adminDb.supplier.create({
    data: { organizationId: organization.id, name: "CFAO Motors", whatsappPhone: "+2250747218890" },
  });
  const filter = await adminDb.product.create({
    data: {
      organizationId: organization.id,
      sku: "FH-TOY-001",
      name: "Filtre à huile Corolla",
      category: "Filtration",
      barcode: "4987654321098",
      salePrice: 6000,
      averageCost: 3500,
      purchasePrice: 3500,
      minStock: 10,
      compatibleWith: ["TOYOTA|COROLLA|2014-2019"],
      defaultSupplierId: supplier.id,
    },
  });
  const pads = await adminDb.product.create({
    data: {
      organizationId: organization.id,
      sku: "PLQ-AV-01",
      name: "Jeu de plaquettes avant",
      category: "Freinage",
      salePrice: 25000,
      averageCost: 18000,
      purchasePrice: 18000,
    },
  });
  // Stock initial : 12 filtres à 3 500 (onHand = Σ mouvements).
  await adminDb.stockLevel.create({
    data: { organizationId: organization.id, siteId: site.id, productId: filter.id, onHand: 12 },
  });
  await adminDb.stockMovement.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      productId: filter.id,
      type: "PURCHASE_RECEIPT",
      quantity: 12,
      unitCost: 3500,
      costAfter: 3500,
    },
  });
  const po = await adminDb.purchaseOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      supplierId: supplier.id,
      number: "BC-YOP-2026-00008",
      status: "SENT",
      orderedAt: new Date(),
      total: 252_000,
      lines: {
        create: [
          { organizationId: organization.id, productId: filter.id, quantity: 20, unitCost: 3600 },
          { organizationId: organization.id, productId: pads.id, quantity: 10, unitCost: 18000 },
        ],
      },
    },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      phone: "+2250747218890",
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
      year: 2018,
    },
  });
  const repairOrder = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "APPROVED",
    },
  });
  return { organization, token, site, filter, pads, po, repairOrder };
}

async function login(page: Page, token: string) {
  await page
    .context()
    .addCookies([{ name: "atelieros_session", value: token, domain: "localhost", path: "/" }]);
}

/** Attendre l'hydratation : un clic sur le HTML rendu côté serveur serait perdu. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

test("parcours stock : réception partielle, CMP, réservation, sortie, inventaire", async ({
  page,
}) => {
  const { token, site, filter, po, repairOrder } = await setup();
  await login(page, token);

  // 1. Réception partielle : 20 filtres à 3 800 (au lieu de 3 600) et 6 jeux de plaquettes.
  await open(page, `/achats/${po.id}`);
  await expect(page.getByRole("heading", { name: "BC-YOP-2026-00008" })).toBeVisible();
  await page.getByRole("button", { name: "Réceptionner" }).click();
  const dialog = page.getByRole("dialog", { name: /Réception/ });
  await dialog.getByLabel("Qté reçue — FH-TOY-001").fill("20");
  const cost = dialog.getByLabel("Coût unitaire HT — FH-TOY-001");
  // MoneyInput : le focus réécrit le champ (montant brut sélectionné) avant la saisie.
  await cost.click();
  await cost.fill("3800");
  await cost.blur();
  await dialog.getByLabel("Qté reçue — PLQ-AV-01").fill("6");
  await dialog.getByRole("button", { name: "Valider la réception" }).click();
  await expect(page.getByText("Réception enregistrée.")).toBeVisible();
  await expect(page.getByText(/Écarts de prix signalés/)).toBeVisible();
  await expect(page.getByText("Reçu partiellement").first()).toBeVisible();
  await expect(page.getByTestId("received-PLQ-AV-01").first()).toHaveText("6");

  // 2. CMP recalculé : (12 × 3 500 + 20 × 3 800) / 32 = 3 687,5 → 3 688.
  await open(page, `/stock/${filter.id}`);
  await expect(page.getByTestId("average-cost")).toHaveText(/3\s688\sFCFA/);
  await expect(page.getByTestId("available-YOP").first()).toContainText("32");

  // 3. Réservation pour l'OR du véhicule 2547 GH 01.
  await page.getByRole("button", { name: "Réserver pour un OR" }).click();
  const reserve = page.getByRole("dialog", { name: "Réserver pour un ordre de réparation" });
  await reserve.getByLabel("Ordre de réparation (numéro ou plaque)").fill("2547");
  await reserve.getByRole("button", { name: "OR-YOP-2026-00042 · 2547 GH 01" }).click();
  await reserve.getByRole("button", { name: "Réserver" }).click();
  await expect(reserve.getByText("1 réservé(s).")).toBeVisible();
  await reserve.getByRole("button", { name: "Fermer" }).last().click();
  await expect(page.getByTestId("available-YOP").first()).toContainText("31");

  // 4. Sortie depuis la file du magasin.
  await open(page, "/stock/sorties");
  const item = page.getByTestId("queue-item").filter({ hasText: "OR-YOP-2026-00042" });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Sortir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Valider la sortie" }).click();
  await expect(page.getByText("Rien à sortir pour l'instant.")).toBeVisible();

  // 5. Stock et historique corrects.
  await open(page, `/stock/${filter.id}`);
  await expect(page.getByTestId("available-YOP").first()).toContainText("31");
  await page.getByRole("button", { name: "Mouvements" }).click();
  await expect(page.getByText("OR-YOP-2026-00042").first()).toBeVisible();
  await expect(page.getByText("Sortie OR").first()).toBeVisible();
  const issue = await adminDb.stockMovement.findFirstOrThrow({
    where: { productId: filter.id, type: "ISSUE_TO_RO" },
  });
  expect(issue).toMatchObject({ quantity: -1, unitCost: 3688, repairOrderId: repairOrder.id });

  // 6. Inventaire : 30 comptés pour 31 théoriques → écart −1 validé.
  await open(page, "/stock/inventaires");
  await page.getByRole("button", { name: "Nouvel inventaire" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer l'inventaire" }).click();
  await expect(page.getByRole("heading", { name: /^INV-YOP-\d{4}-00001$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Démarrer le comptage" }).click();
  const line = page.getByTestId("count-line-FH-TOY-001");
  await expect(line.getByLabel("Compté")).toBeVisible();
  await line.getByLabel("Compté").fill("30");
  await line.getByLabel("Compté").press("Enter");
  await expect(line).toContainText(/[-−]1/);
  await page.getByRole("button", { name: "Soumettre" }).click();
  await page.getByRole("button", { name: "Valider l'inventaire" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("Inventaire validé : 1 correction(s).")).toBeVisible();

  const level = await adminDb.stockLevel.findFirstOrThrow({
    where: { siteId: site.id, productId: filter.id },
  });
  expect(level).toMatchObject({ onHand: 30, reserved: 0 });
  const correction = await adminDb.stockMovement.findFirstOrThrow({
    where: { productId: filter.id, type: "COUNT_CORRECTION" },
  });
  expect(correction.quantity).toBe(-1);
  const sum = await adminDb.stockMovement.aggregate({
    where: { productId: filter.id, siteId: site.id },
    _sum: { quantity: true },
  });
  expect(sum._sum.quantity).toBe(30);
});

test.describe("mobile 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("écrans stock et achats sans défilement horizontal", async ({ page }) => {
    const { token, filter, po } = await setup();
    await login(page, token);
    for (const url of [
      "/stock",
      `/stock/${filter.id}`,
      "/stock/sorties",
      "/stock/mouvements",
      "/stock/inventaires",
      "/stock/transferts",
      "/stock/valorisation",
      "/achats",
      `/achats/${po.id}`,
      "/achats/suggestions",
      "/achats/fournisseurs",
    ]) {
      await open(page, url);
      await expect(page.locator("h1").first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `défilement horizontal sur ${url}`).toBe(false);
    }
  });
});
