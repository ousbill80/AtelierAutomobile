import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M17 US-M17-03/04 — parcours principal avec le fournisseur IA `console` (aucune clé requise) :
// OR inspecté → « Proposer un devis » → lignes du catalogue + « À chiffrer » → « Créer le
// brouillon » → devis DRAFT → « Générer l'explication client » → validée. Écran 390 px.

test("pré-devis IA : OR inspecté → proposition → brouillon → explication validée", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Devis IA ${randomBytes(3).toString("hex")}`,
      plan: "PRO",
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Réceptionnaire IA",
      email: `e2e-devis-ia-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "ADVISOR", siteIds: [] },
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
  const plateSuffix = String(1000 + Math.floor(Math.random() * 8999));
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: `${plateSuffix} GH 01`,
      plateCompact: `${plateSuffix}GH01`,
      make: "Toyota",
      model: "Corolla",
      year: 2018,
    },
  });
  const padsLabor = await adminDb.laborOperation.create({
    data: {
      organizationId: organization.id,
      code: "PLQ-AV",
      name: "Remplacement plaquettes AV",
      category: "Freinage",
      standardHours: 0.8,
    },
  });
  const pads = await adminDb.product.create({
    data: {
      organizationId: organization.id,
      sku: "PLQ-COR",
      name: "Plaquettes AV Corolla 2014-2019",
      category: "Freinage",
      salePrice: 28_000,
      compatibleWith: ["TOYOTA|COROLLA|2014-2019"],
    },
  });
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "DIAGNOSING",
      complaint: "Bruit au freinage",
    },
  });
  const inspection = await adminDb.inspection.create({
    data: { organizationId: organization.id, repairOrderId: order.id, completedAt: new Date() },
  });
  await adminDb.inspectionItem.createMany({
    data: [
      {
        organizationId: organization.id,
        inspectionId: inspection.id,
        category: "Freinage",
        label: "Plaquettes avant",
        result: "URGENT",
        measurement: "2 mm",
        recommendedLaborIds: [padsLabor.id],
        recommendedProductIds: [pads.id],
        sortOrder: 0,
      },
      {
        organizationId: organization.id,
        inspectionId: inspection.id,
        category: "Freinage",
        label: "Disques avant",
        result: "WATCH",
        sortOrder: 1,
      },
    ],
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  await page.goto(`/ordres/${order.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Devis", exact: true }).click();
  await page.getByRole("button", { name: /Proposer un devis/ }).click();

  const panel = page.getByTestId("ai-quote-draft");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Proposé par l'assistant")).toBeVisible();
  await expect(panel.getByText("Remplacement plaquettes AV")).toBeVisible();
  await expect(panel.getByText("Plaquettes AV Corolla 2014-2019")).toBeVisible();
  await expect(
    panel.getByText("À chiffrer : disques avant (non trouvée au catalogue)"),
  ).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);

  await panel.getByRole("button", { name: "Créer le brouillon" }).click();
  await page.waitForURL(/\/devis\//);
  await expect(page.getByRole("heading", { name: "DEV-YOP-2026-00001" })).toBeVisible();

  await page.getByRole("button", { name: /Générer l'explication client/ }).click();
  const explanation = page.getByTestId("ai-explanation");
  await expect(explanation).toBeVisible();
  await explanation.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Explication validée : elle apparaît sur le portail.")).toBeVisible();

  const quote = await adminDb.quote.findFirstOrThrow({
    where: { organizationId: organization.id, repairOrderId: order.id },
    include: { lines: true },
  });
  expect(quote.status).toBe("DRAFT");
  expect(quote.lines.map((l) => l.description)).toEqual(
    expect.arrayContaining(["Remplacement plaquettes AV", "Plaquettes AV Corolla 2014-2019"]),
  );
  expect(Object.keys((quote.customerExplanation ?? {}) as object).length).toBeGreaterThan(0);
  await context.close();
});
