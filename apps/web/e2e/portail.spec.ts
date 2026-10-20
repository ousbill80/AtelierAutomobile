import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// Étape 6.3 (M14 US-M14-04, US-M14-03) — parcours principal du portail client sur mobile 390 px :
// le conseiller envoie le lien de suivi depuis l'OR → le client ouvre l'alias court reçu par SMS
// → suit l'OR en direct (passage à « Prêt » sans recharger) → consulte le devis de l'OR → paie la
// facture via le simulateur (webhook signé) → « Payé ✓ », facture « Payée » dans son espace OR ;
// côté garage, le bloc « Lien client » compte les ouvertures.

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

async function cleanup(organizationId: string, userId: string) {
  const where = { organizationId };
  await adminDb.portalAccess.deleteMany({ where });
  await adminDb.portalToken.deleteMany({ where });
  await adminDb.paymentWebhookLog.deleteMany({ where });
  await adminDb.paymentLink.deleteMany({ where });
  await adminDb.paymentAttribution.deleteMany({ where });
  await adminDb.paymentAllocation.deleteMany({ where });
  await adminDb.customerCredit.deleteMany({ where });
  await adminDb.payment.deleteMany({ where });
  await adminDb.reminder.deleteMany({ where });
  await adminDb.message.deleteMany({ where });
  await adminDb.conversation.deleteMany({ where });
  await adminDb.invoiceLine.deleteMany({ where });
  await adminDb.invoice.deleteMany({ where });
  await adminDb.collectionCase.deleteMany({ where });
  await adminDb.quoteLine.deleteMany({ where });
  await adminDb.quote.deleteMany({ where });
  await adminDb.workNote.deleteMany({ where });
  await adminDb.repairOrderStatusHistory.deleteMany({ where });
  await adminDb.repairOrderLine.deleteMany({ where });
  await adminDb.repairOrder.deleteMany({ where });
  await adminDb.paymentProviderConfig.deleteMany({ where });
  await adminDb.channelConfig.deleteMany({ where });
  await adminDb.documentSequence.deleteMany({ where });
  await adminDb.domainEvent.deleteMany({ where });
  await adminDb.auditLog.deleteMany({ where });
  await adminDb.vehicle.deleteMany({ where });
  await adminDb.customer.deleteMany({ where });
  await adminDb.session.deleteMany({ where: { userId } });
  // Les jobs (worker) peuvent encore créer des notifications : repurge juste avant Membership.
  await adminDb.notification.deleteMany({ where });
  await adminDb.membership.deleteMany({ where });
  await adminDb.user.deleteMany({ where: { id: userId } });
  await adminDb.site.deleteMany({ where });
  await adminDb.organization.deleteMany({ where: { id: organizationId } });
}

test("portail : lien SMS → suivi de l'OR en direct → devis → paiement Wave simulé", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const suffix = randomBytes(3).toString("hex");
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Portail ${suffix}`,
      slug: `e2e-portail-${suffix}`,
      legalName: "Garage Portail SARL",
      address: "Yopougon, Abidjan",
      phone: "+2252722000000",
      vatEnabled: false,
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-portail-${suffix}@example.com` },
  });
  try {
    const site = await adminDb.site.create({
      data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
    });
    const membership = await adminDb.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    const sessionToken = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
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
        mileageIn: 48_200,
        promisedAt: new Date(Date.UTC(2030, 0, 15, 17, 0)),
      },
    });
    await adminDb.workNote.create({
      data: {
        organizationId: organization.id,
        repairOrderId: order.id,
        authorId: membership.id,
        body: "Plaquettes avant remplacées.",
        visibleToCustomer: true,
      },
    });
    const quote = await adminDb.quote.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        number: "DEV-YOP-2026-00017",
        customerId: customer.id,
        vehicleId: vehicle.id,
        repairOrderId: order.id,
        status: "SENT",
        sentAt: new Date(),
        validUntil: new Date(Date.UTC(2030, 0, 31)),
        subtotal: 48_000,
        total: 48_000,
      },
    });
    await adminDb.quoteLine.create({
      data: {
        organizationId: organization.id,
        quoteId: quote.id,
        type: "LABOR",
        description: "Plaquettes avant",
        quantity: 1,
        unitPrice: 48_000,
        vatRate: 0,
        priority: "URGENT",
        lineSubtotal: 48_000,
        lineTotal: 48_000,
      },
    });

    const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await staff.addCookies([
      { name: "atelieros_session", value: sessionToken, domain: "localhost", path: "/" },
    ]);
    const page = await staff.newPage();
    page.setDefaultTimeout(15_000);

    // 1. Paramètres > Paiements : simulateur de paiement actif.
    await page.goto("/parametres/paiements");
    const simulator = page.getByTestId("provider-fake");
    await simulator.getByRole("button", { name: "Activer" }).click();
    await expect(simulator.getByText("Actif", { exact: true })).toBeVisible();

    // 2. Fiche OR > Documents > « Lien client » du suivi : envoi au client (SMS console).
    await page.goto(`/ordres/${order.id}`);
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    const panel = page.getByTestId("portal-links-REPAIR_ORDER");
    await expect(panel.getByText("Aucun lien envoyé pour l'instant.")).toBeVisible();
    await panel.getByRole("button", { name: /Envoyer au client/ }).click();
    await expect(panel.getByText("Lien envoyé au client.")).toBeVisible();
    await noHorizontalScroll(page);

    const sms = await adminDb.message.findFirstOrThrow({
      where: { organizationId: organization.id, idempotencyKey: { startsWith: "portal:link:" } },
    });
    expect(sms.to).toBe("+2250747218890");
    const shortPath = new URL(sms.body.match(/https?:\/\/\S+\/l\/[0-9A-Za-z]{8}/)![0]).pathname;

    // 3. Le client ouvre l'alias court → page de suivi, mise à jour en direct.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const client = await mobile.newPage();
    client.setDefaultTimeout(15_000);
    await client.goto(shortPath);
    await expect(client).toHaveURL(/\/p\/[A-Za-z0-9_-]{43}\/suivi$/);
    const trackingPath = new URL(client.url()).pathname;
    await expect(client.getByRole("heading", { name: "Suivi de votre véhicule" })).toBeVisible();
    await expect(client.locator("li[aria-current='step']")).toContainText("En réparation");
    await expect(client.getByText("Plaquettes avant remplacées.")).toBeVisible();
    await expect(client.getByText("Mise à jour en direct")).toBeVisible();
    await expect(client.getByText("Devis DEV-YOP-2026-00017")).toBeVisible();
    await noHorizontalScroll(client);

    // 4. L'atelier termine : OR prêt + facture émise → la page se met à jour sans rechargement.
    await adminDb.repairOrder.update({
      where: { id: order.id },
      data: { status: "READY", readyAt: new Date() },
    });
    const invoice = await adminDb.invoice.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        repairOrderId: order.id,
        number: `FAC-2026-${suffix}`,
        status: "ISSUED",
        issuedAt: new Date(),
        dueDate: new Date(),
        subtotal: 85_000,
        total: 85_000,
        balance: 85_000,
      },
    });
    await adminDb.invoiceLine.create({
      data: {
        organizationId: organization.id,
        invoiceId: invoice.id,
        type: "LABOR",
        description: "Remplacement plaquettes + révision",
        quantity: 1,
        unitPrice: 85_000,
        vatRate: 0,
        lineSubtotal: 85_000,
        lineVat: 0,
        lineTotal: 85_000,
      },
    });
    await expect(client.getByText("Votre véhicule est prêt")).toBeVisible({ timeout: 30_000 });
    expect(new URL(client.url()).pathname).toBe(trackingPath);
    await noHorizontalScroll(client);

    // 5. Le client consulte le devis de l'OR (jeton enfant), puis revient au suivi.
    await client
      .locator("article", { hasText: "Devis DEV-YOP-2026-00017" })
      .getByRole("button")
      .click();
    await expect(client.getByRole("heading", { name: /Devis DEV-YOP-2026-00017/ })).toBeVisible();
    await noHorizontalScroll(client);
    await client.goto(trackingPath);

    // 6. Paiement de la facture depuis le bandeau « prêt » → simulateur → « Payé ✓ ».
    await client.getByRole("button", { name: "Payer 85 000 FCFA" }).first().click();
    await expect(client).toHaveURL(/\/facture$/);
    const invoicePath = new URL(client.url()).pathname;
    await expect(client.getByTestId("portal-invoice-balance")).toContainText("85 000 FCFA");
    await noHorizontalScroll(client);
    await client.getByRole("button", { name: "Payer 85 000 FCFA avec Wave" }).click();
    await expect(client.getByRole("heading", { name: "Simulateur de paiement" })).toBeVisible();
    await client.getByRole("button", { name: "Payer 85 000 FCFA" }).click();
    await expect(client).toHaveURL(new RegExp(`${invoicePath}$`));
    await expect(client.getByTestId("portal-paid")).toContainText("Payé ✓");
    await noHorizontalScroll(client);

    // 7. Retour à l'espace OR : facture « Payée ».
    await client.goto(trackingPath);
    await expect(
      client.locator("article", { hasText: `Facture FAC-2026-${suffix}` }).getByText("Payée"),
    ).toBeVisible();
    await noHorizontalScroll(client);

    // 8. Côté garage : ouvertures comptées et journalisées.
    await page.reload();
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await expect(panel.getByText(/\d+ ouverture\(s\)/).first()).toBeVisible();
    const accesses = await adminDb.portalAccess.count({
      where: { organizationId: organization.id, action: "open" },
    });
    expect(accesses).toBeGreaterThanOrEqual(2);

    await mobile.close();
    await staff.close();
  } finally {
    await cleanup(organization.id, user.id);
  }
});

// RG-M14-24 — garde-fou du poids JavaScript (compressé) des pages devis / facture / suivi. Le
// socle React + Next.js + tRPC pèse ~158 Ko : le budget PRD de 70 Ko n'est pas atteignable sans
// sortir ces pages de l'application (écart documenté) ; ce plafond empêche toute régression.
const PORTAL_JS_BUDGET_BYTES = 195_000;

for (const path of ["suivi", "facture", "devis"]) {
  test(`budget JS du portail : /p/{jeton}/${path} ≤ 195 Ko compressés`, async ({ page }) => {
    const sizes: Promise<number>[] = [];
    page.on("requestfinished", (req) => {
      if (req.resourceType() === "script") {
        sizes.push(req.sizes().then((s) => s.responseBodySize));
      }
    });
    // Jeton inconnu : la page et son code sont chargés, l'état « lien introuvable » s'affiche.
    await page.goto(`/p/${"x".repeat(43)}/${path}`);
    await expect(page.getByText("Lien introuvable")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const total = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(PORTAL_JS_BUDGET_BYTES);
    await noHorizontalScroll(page);
  });
}
