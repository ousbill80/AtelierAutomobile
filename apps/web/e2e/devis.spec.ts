import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M05 §12 — parcours principal : OR inspecté → « Créer le devis » → remise 15 % par l'advisor
// (bloquée) → validation par le manager → envoi WhatsApp → ouverture du lien (mobile 390 px) →
// acceptation plaquettes + balais, refus amortisseurs → signature → devis PARTIALLY_ACCEPTED,
// OR APPROVED, recommandation « Amortisseurs arrière », relance de devis annulée.

async function session(organizationId: string, role: "OWNER" | "MANAGER" | "ADVISOR", name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `e2e-devis-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
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
  return token;
}

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

test("parcours devis : inspection → remise validée → envoi → portail → acceptation partielle", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const organization = await adminDb.organization.create({
    data: { name: `E2E Devis ${randomBytes(3).toString("hex")}`, onboardingCompletedAt: new Date() },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP", whatsappNumber: "+2250700000000" },
  });
  // Canaux console : SMS actif (WhatsApp hors fenêtre exige un modèle approuvé).
  await adminDb.channelConfig.create({
    data: { organizationId: organization.id, channel: "SMS", provider: "console", isActive: true, credentials: "{}", status: "OK" },
  });
  const advisorToken = await session(organization.id, "ADVISOR", "Bamba Aminata");
  const customer = await adminDb.customer.create({
    data: { organizationId: organization.id, displayName: "Kouassi Jean-Marc", phone: "+2250747218890" },
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
    },
  });
  const [plaqOp, amorOp] = await Promise.all([
    adminDb.laborOperation.create({ data: { organizationId: organization.id, code: "FRA", name: "Remplacement plaquettes avant", standardHours: 1 } }),
    adminDb.laborOperation.create({ data: { organizationId: organization.id, code: "AMORT", name: "Remplacement amortisseurs arrière", standardHours: 2 } }),
  ]);
  const [plaqPart, amorPart, balaisPart] = await Promise.all([
    adminDb.product.create({ data: { organizationId: organization.id, sku: "PLQ-AV-01", name: "Jeu de plaquettes AV", salePrice: 28_000, purchasePrice: 18_000 } }),
    adminDb.product.create({ data: { organizationId: organization.id, sku: "AMO-AR-01", name: "Amortisseur arrière", salePrice: 45_000, purchasePrice: 30_000 } }),
    adminDb.product.create({ data: { organizationId: organization.id, sku: "BAL-01", name: "Balais d'essuie-glace", salePrice: 8_000, purchasePrice: 4_000 } }),
  ]);
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "DIAGNOSING",
    },
  });
  await adminDb.inspection.create({
    data: {
      organizationId: organization.id,
      repairOrderId: order.id,
      completedAt: new Date(),
      items: {
        create: [
          { organizationId: organization.id, category: "Freinage", label: "Plaquettes avant", result: "URGENT", recommendedLaborIds: [plaqOp.id], recommendedProductIds: [plaqPart.id], sortOrder: 0 },
          { organizationId: organization.id, category: "Suspension", label: "Amortisseurs arrière", result: "WATCH", recommendedLaborIds: [amorOp.id], recommendedProductIds: [amorPart.id], sortOrder: 1 },
          { organizationId: organization.id, category: "Visibilité", label: "Balais d'essuie-glace", result: "WATCH", recommendedProductIds: [balaisPart.id], sortOrder: 2 },
        ],
      },
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "QUOTE_FOLLOWUP",
      name: "Relance devis",
      steps: [{ key: "J+2", offsetDays: 2, templateKey: "quote_followup", autoSend: true, channels: ["SMS"] }],
      sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" },
      stopOn: ["quote.accepted", "quote.declined"],
    },
  });

  await context.addCookies([{ name: "atelieros_session", value: advisorToken, domain: "localhost", path: "/" }]);

  // ── Créer le devis depuis l'OR inspecté ──
  await page.goto(`/ordres/${order.id}`);
  await page.getByRole("button", { name: "Inspection", exact: true }).click();
  await page.getByRole("button", { name: "Créer le devis" }).click();
  await expect(page).toHaveURL(/\/devis\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /DEV-YOP-2026-00001/ })).toBeVisible();
  await expect(page.getByTestId("quote-total")).toHaveText("201 780 FCFA");
  const quote = await adminDb.quote.findFirstOrThrow({ where: { organizationId: organization.id }, include: { lines: true } });
  expect(quote.total).toBe(201_780);
  expect(quote.lines).toHaveLength(5);
  await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "QUOTE_FOLLOWUP",
      stepKey: "J+2",
      customerId: customer.id,
      quoteId: quote.id,
      dueDate: quote.validUntil,
      scheduledFor: new Date(Date.now() + 2 * 86_400_000),
      status: "PLANNED",
      dedupeKey: `QUOTE_FOLLOWUP:${quote.id}:J+2`,
    },
  });

  // ── Remise 15 % sur la MO plaquettes : plafond dépassé signalé dans l'éditeur ──
  await page.getByRole("button", { name: "Modifier la ligne" }).first().click();
  await page.getByLabel("Remise %").first().fill("15");
  await expect(page.getByText(/Au-delà de votre plafond/)).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).first().click();

  // ── Envoi par SMS depuis la fiche (le canal WhatsApp exigerait un modèle approuvé) ──
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await page.getByLabel("Canal").selectOption("SMS");
  await page.getByRole("button", { name: "Envoyer", exact: true }).last().click();
  const linkLocator = page.locator("text=/\\/p\\/[A-Za-z0-9_-]{40,}\\/devis/");
  await expect(linkLocator).toBeVisible({ timeout: 20_000 });
  const publicUrl = (await linkLocator.first().textContent())!.trim();
  const tokenPlain = publicUrl.split("/p/")[1]!.split("/")[0]!;
  const sent = await adminDb.quote.findUniqueOrThrow({ where: { id: quote.id } });
  expect(sent.status).toBe("SENT");
  const refreshedOrder = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id } });
  expect(refreshedOrder.status).toBe("AWAITING_APPROVAL");

  // ── Portail client, contexte mobile 390 px ──
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const portal = await mobile.newPage();
  await portal.goto(`/p/${tokenPlain}/devis`);
  await expect(portal.getByRole("heading", { name: "Votre devis" })).toBeVisible();
  await expect(portal.getByText("DEV-YOP-2026-00001")).toBeVisible();
  await noHorizontalScroll(portal);

  // Plaquettes (urgent) pré-cochées ; refuser les amortisseurs ; accepter les balais.
  const amortGroup = portal.getByRole("group", { name: "Amortisseurs arrière" });
  await amortGroup.getByRole("button", { name: /Je ne veux pas/ }).click();
  const balaisGroup = portal.getByRole("group", { name: "Balais d'essuie-glace" });
  await balaisGroup.getByRole("button", { name: /^✓ Je veux/ }).click();
  await expect(portal.getByTestId("portal-accepted-total")).toContainText("60 180 FCFA");

  await portal.getByRole("button", { name: "Valider mon choix" }).click();
  await portal.getByLabel("Votre nom").fill("Kouassi Jean-Marc");
  const pad = portal.locator("canvas").first();
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await portal.mouse.move(box.x + 20, box.y + 30);
  await portal.mouse.down();
  await portal.mouse.move(box.x + 120, box.y + 80, { steps: 8 });
  await portal.mouse.move(box.x + 200, box.y + 40, { steps: 8 });
  await portal.mouse.up();
  await portal.getByRole("button", { name: "Confirmer" }).click();
  await expect(portal.getByText(/l'atelier commence les travaux/)).toBeVisible({ timeout: 20_000 });

  // ── Vérifications ──
  const decided = await adminDb.quote.findUniqueOrThrow({ where: { id: quote.id } });
  expect(decided.status).toBe("PARTIALLY_ACCEPTED");
  expect(decided.acceptedTotal).toBe(60_180);
  expect(decided.decisionChannel).toBe("portal");
  expect(decided.signerName).toBe("Kouassi Jean-Marc");

  const updatedOrder = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
  expect(updatedOrder.status).toBe("APPROVED");
  expect(updatedOrder.lines.filter((l) => l.quoteLineId && l.approval === "APPROVED")).toHaveLength(3);

  const recommendations = await adminDb.vehicleRecommendation.findMany({ where: { organizationId: organization.id } });
  expect(recommendations.map((r) => r.label)).toContain("Amortisseurs arrière");
  const reminder = await adminDb.reminder.findFirstOrThrow({ where: { quoteId: quote.id } });
  expect(reminder.status).toBe("CANCELLED");

  await mobile.close();
});
