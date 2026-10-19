import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { processRemindersOnEventJob } from "../../worker/src/jobs/remindersOnEvent";

// M05 §12 — parcours principal : OR-YOP-2026-00042 inspecté → « Créer le devis » → remise de
// 15 % par le réceptionnaire (bloquée) → validation par le chef d'atelier → envoi WhatsApp
// (wa.me) → lien ouvert sur mobile 390 px → plaquettes et balais acceptés, amortisseurs refusés
// (« Je le ferai plus tard ») → signature → devis PARTIALLY_ACCEPTED, total accepté affiché, OR
// APPROVED avec 2 groupes approuvés, recommandation « Amortisseurs arrière », relance annulée.

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

async function sessionFor(organizationId: string, name: string, role: "ADVISOR" | "MANAGER") {
  const user = await adminDb.user.create({
    data: { name, email: `e2e-devis-${randomBytes(4).toString("hex")}@example.com` },
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
  return { token, membershipId: membership.id };
}

async function staffPage(browser: Browser, token: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  // wa.me s'ouvre dans un nouvel onglet : inutile (et hors réseau) dans le test.
  await page.addInitScript(() => {
    window.open = () => null;
  });
  return page;
}

test("parcours devis : inspection → remise validée → envoi → approbation mobile signée", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Devis ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const advisor = await sessionFor(organization.id, "E2E Réceptionnaire", "ADVISOR");
  const manager = await sessionFor(organization.id, "E2E Chef d'atelier", "MANAGER");
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
    },
  });
  const [padsLabor, shocksLabor] = await Promise.all([
    adminDb.laborOperation.create({
      data: {
        organizationId: organization.id,
        code: "PLQ-AV",
        name: "Remplacement plaquettes AV",
        standardHours: 1,
      },
    }),
    adminDb.laborOperation.create({
      data: {
        organizationId: organization.id,
        code: "AMO-AR",
        name: "Remplacement amortisseurs AR",
        standardHours: 2,
      },
    }),
  ]);
  const [pads, shocks, wipers] = await Promise.all([
    adminDb.product.create({
      data: {
        organizationId: organization.id,
        sku: "PLQ-COR",
        name: "Jeu de plaquettes AV Toyota Corolla",
        salePrice: 28_000,
      },
    }),
    adminDb.product.create({
      data: {
        organizationId: organization.id,
        sku: "AMO-COR",
        name: "Amortisseur AR",
        salePrice: 45_000,
      },
    }),
    adminDb.product.create({
      data: {
        organizationId: organization.id,
        sku: "BAL",
        name: "Jeu de balais d'essuie-glace",
        salePrice: 8_000,
      },
    }),
  ]);
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "AWAITING_APPROVAL",
      advisorId: advisor.membershipId,
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
        recommendedLaborIds: [padsLabor.id],
        recommendedProductIds: [pads.id],
        sortOrder: 0,
      },
      {
        organizationId: organization.id,
        inspectionId: inspection.id,
        category: "Suspension",
        label: "Amortisseurs arrière",
        result: "WATCH",
        recommendedLaborIds: [shocksLabor.id],
        recommendedProductIds: [shocks.id],
        sortOrder: 1,
      },
      {
        organizationId: organization.id,
        inspectionId: inspection.id,
        category: "Visibilité",
        label: "Balais d'essuie-glace",
        result: "WATCH",
        recommendedProductIds: [wipers.id],
        sortOrder: 2,
      },
    ],
  });

  // ── Réceptionnaire : « Créer le devis » depuis l'inspection de l'OR ──
  const page = await staffPage(browser, advisor.token);
  await page.goto(`/ordres/${order.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Inspection", exact: true }).click();
  await page.getByRole("button", { name: "Créer le devis" }).click();
  await expect(page).toHaveURL(/\/devis\/[^/]+$/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "DEV-YOP-2026-00001" })).toBeVisible();
  const quoteId = page.url().split("/devis/")[1]!;
  await expect(page.getByTestId("quote-total")).toHaveText("148 680 FCFA");

  // ── Remise de 15 % sur la MO des amortisseurs : au-delà du plafond ADVISOR (10 %) ──
  const shocksGroup = page.getByRole("article", { name: "Amortisseurs arrière" });
  const discount = shocksGroup.getByLabel("Remise %").first();
  await discount.fill("15");
  await discount.blur();
  await expect(page.getByText(/validation du chef d'atelier requise avant l'envoi/)).toBeVisible();
  await page.getByLabel("Motif de la remise").selectOption("Client fidèle");
  await expect(page.getByRole("button", { name: /Envoyer/ })).toBeDisabled();

  // ── Chef d'atelier : validation de la remise ──
  const managerPage = await staffPage(browser, manager.token);
  await managerPage.goto(`/devis/${quoteId}`);
  await managerPage.waitForLoadState("networkidle");
  await managerPage.getByRole("button", { name: "Valider la remise" }).click();
  await managerPage.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(
    managerPage.getByText(/validation du chef d'atelier requise avant l'envoi/),
  ).toHaveCount(0);
  expect(
    (await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } })).discountApprovalStatus,
  ).toBe("APPROVED");

  // ── Réceptionnaire : envoi par WhatsApp (wa.me) ──
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Envoyer/ }).click();
  await page.getByLabel("Ouvrir dans WhatsApp (wa.me)").check();
  await page.getByRole("dialog").getByRole("button", { name: "Ouvrir dans WhatsApp" }).click();
  const publicUrl = (await page.getByTestId("quote-public-url").textContent())!.trim();
  expect(publicUrl).toMatch(/\/p\/[\w-]+\/devis$/);
  const sent = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
  expect(sent).toMatchObject({ status: "SENT", sentVia: "WA_LINK" });

  // Relance M10 planifiée (J+2), qui doit être annulée par la décision.
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "QUOTE_FOLLOWUP",
      name: "Relance devis",
      // Inactive : seule l'annulation de la relance ci-dessous est vérifiée (pas de planification).
      isActive: false,
      steps: [
        {
          key: "J+2",
          label: "Relance J+2",
          offsetDays: 2,
          anchor: "sentAt",
          templateKey: "quote_followup",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" },
    },
  });
  const reminder = await adminDb.reminder.create({
    data: {
      organizationId: organization.id,
      ruleId: rule.id,
      type: "QUOTE_FOLLOWUP",
      stepKey: "J+2",
      customerId: customer.id,
      vehicleId: vehicle.id,
      quoteId,
      dueDate: new Date(),
      scheduledFor: new Date(Date.now() + 2 * 86_400_000),
      dedupeKey: `QUOTE_FOLLOWUP:${quoteId}:J+2`,
    },
  });

  // ── Client : lien ouvert sur mobile (390 px), sans session ──
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await mobile.newPage();
  client.setDefaultTimeout(15_000);
  await client.goto(publicUrl);
  await client.waitForLoadState("networkidle");
  await expect(client.getByRole("heading", { name: /Devis DEV-YOP-2026-00001/ })).toBeVisible();
  await noHorizontalScroll(client);
  expect((await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("VIEWED");
  await client
    .getByRole("radiogroup", { name: "Balais d'essuie-glace" })
    .getByRole("radio", { name: /Accepter/ })
    .click();
  await client
    .getByRole("radiogroup", { name: "Amortisseurs arrière" })
    .getByRole("radio", { name: /Refuser/ })
    .click();
  await expect(client.getByTestId("portal-accepted-total")).toContainText("60 180 FCFA TTC");
  await client.getByRole("button", { name: "Valider mon choix" }).click();
  await client.getByLabel("Motif du refus (facultatif)").selectOption("later");
  const pad = client.getByTestId("signature-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await client.mouse.move(box.x + 20, box.y + 30);
  await client.mouse.down();
  await client.mouse.move(box.x + 120, box.y + 80, { steps: 8 });
  await client.mouse.move(box.x + 220, box.y + 40, { steps: 8 });
  await client.mouse.up();
  await client.getByRole("button", { name: "Valider mon choix" }).click();
  await expect(client.getByText("Merci, l'atelier commence les travaux acceptés.")).toBeVisible();
  await noHorizontalScroll(client);

  // ── Vérifications ──
  const decided = await adminDb.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { lines: true },
  });
  expect(decided).toMatchObject({
    status: "PARTIALLY_ACCEPTED",
    acceptedTotal: 60_180,
    decisionChannel: "portal",
    signerName: "Kouassi Jean-Marc",
  });
  expect(
    decided.lines.filter((l) => l.accepted === false).every((l) => l.declineReason === "later"),
  ).toBe(true);
  const ro = await adminDb.repairOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { lines: true },
  });
  expect(ro.status).toBe("APPROVED");
  const approvedGroups = new Set(
    ro.lines
      .filter((l) => l.approval === "APPROVED" && l.approvalSource === "QUOTE")
      .map((l) => l.inspectionItemId),
  );
  expect(approvedGroups.size).toBe(2);
  const recommendations = await adminDb.vehicleRecommendation.findMany({
    where: { repairOrderId: order.id },
  });
  expect(recommendations.map((r) => r.label)).toEqual(["Amortisseurs arrière"]);
  await processRemindersOnEventJob();
  expect((await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe(
    "CANCELLED",
  );

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Partiellement accepté").first()).toBeVisible();
  await expect(page.getByTestId("quote-accepted")).toHaveText("60 180 FCFA");

  // ── Mobile 390 px : pas de défilement horizontal sur les écrans du personnel ──
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/devis", `/devis/${quoteId}`, "/devis/nouveau"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noHorizontalScroll(page);
  }
  await mobile.close();
});
