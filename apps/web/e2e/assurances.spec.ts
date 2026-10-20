import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M16 §12 — parcours principal sur mobile 390 px : sinistre déclaré depuis l'OR → expert planifié
// → devis assurance (prérempli depuis l'OR) envoyé → accord de l'assureur → lettre d'accord
// jointe → « Facturer le sinistre » : 553 720 assureur / 100 000 client (franchise) → émission →
// suivi du règlement de l'assureur (encours, virement, dossier « Partiellement réglé »).

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

async function typeAmount(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  await input.click();
  await input.press("Control+A");
  await input.pressSequentially(value);
  await input.blur();
}

/** Nettoyage limité à l'organisation du test, dans l'ordre des clés étrangères. */
async function cleanup(organizationId: string, userId: string) {
  const where = { organizationId };
  await adminDb.claimFollowUp.deleteMany({ where });
  await adminDb.claimActivity.deleteMany({ where });
  await adminDb.attachment.deleteMany({ where });
  await adminDb.paymentAttribution.deleteMany({ where });
  await adminDb.paymentAllocation.deleteMany({ where });
  await adminDb.customerCredit.deleteMany({ where });
  await adminDb.payment.deleteMany({ where });
  await adminDb.reminder.deleteMany({ where });
  await adminDb.message.deleteMany({ where });
  await adminDb.stockMovement.deleteMany({ where });
  await adminDb.invoiceLine.deleteMany({ where });
  await adminDb.invoice.deleteMany({ where: { ...where, creditedInvoiceId: { not: null } } });
  await adminDb.invoice.deleteMany({ where });
  await adminDb.collectionCase.deleteMany({ where });
  await adminDb.repairOrderStatusHistory.deleteMany({ where });
  await adminDb.repairOrderLine.deleteMany({ where });
  await adminDb.repairOrder.updateMany({ where, data: { insuranceClaimId: null } });
  await adminDb.quoteLine.deleteMany({ where });
  await adminDb.quote.updateMany({ where, data: { insuranceClaimId: null } });
  await adminDb.insuranceClaim.deleteMany({ where });
  await adminDb.quote.deleteMany({ where });
  await adminDb.repairOrder.deleteMany({ where });
  await adminDb.insuranceCompany.deleteMany({ where });
  await adminDb.documentSequence.deleteMany({ where });
  await adminDb.domainEvent.deleteMany({ where });
  await adminDb.auditLog.deleteMany({ where });
  await adminDb.vehicle.deleteMany({ where });
  await adminDb.customer.deleteMany({ where });
  await adminDb.session.deleteMany({ where: { userId } });
  // Des jobs worker peuvent encore notifier : repurge juste avant les memberships.
  await adminDb.notification.deleteMany({ where });
  await adminDb.membership.deleteMany({ where });
  await adminDb.user.deleteMany({ where: { id: userId } });
  await adminDb.site.deleteMany({ where });
  await adminDb.organization.delete({ where: { id: organizationId } });
}

// Le serveur E2E tourne sur l'horloge réelle : l'année des numéros est celle du jour (Abidjan = UTC).
const YEAR = new Date().getUTCFullYear();

test("parcours sinistre : déclaration → accord → facture assureur/client → règlement", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Sinistres ${randomBytes(3).toString("hex")}`,
      legalName: "Garage Sinistres SARL",
      rccm: "CI-ABJ-2020-B-54321",
      ncc: "2012345B",
      address: "Marcory, Abidjan",
      phone: "+2252721000000",
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-sin-${randomBytes(4).toString("hex")}@example.com` },
  });
  try {
    const site = await adminDb.site.create({
      data: { organizationId: organization.id, name: "Marcory", code: "MAR" },
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
        displayName: "Mme Traoré Aminata",
        phone: "+2250707000031",
      },
    });
    const insurerCustomer = await adminDb.customer.create({
      data: {
        organizationId: organization.id,
        type: "COMPANY",
        displayName: "NSIA Assurances",
        source: "assureur",
        paymentTermsDays: 60,
        doNotRemind: true,
      },
    });
    await adminDb.insuranceCompany.create({
      data: {
        organizationId: organization.id,
        name: "NSIA Assurances",
        customerId: insurerCustomer.id,
        claimsEmail: "sinistres@nsia.example",
        paymentTermsDays: 60,
      },
    });
    const suffix = String(1000 + Math.floor(Math.random() * 8999));
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        plate: `${suffix} HJ 01`,
        plateCompact: `${suffix}HJ01`,
        make: "Hyundai",
        model: "Tucson",
      },
    });
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        number: "OR-MAR-2026-00031",
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "CHECKED_IN",
        mileageIn: 61_000,
      },
    });
    // RG-M16-03 : 554 000 HT → 653 720 TTC à la charge de l'assureur.
    const lines = [
      { type: "PART", description: "Pare-choc AV", quantity: 1, unitPrice: 185_000 },
      { type: "PART", description: "Phare AV gauche", quantity: 1, unitPrice: 142_000 },
      {
        type: "CONSUMABLE",
        description: "Peinture et ingrédients",
        quantity: 1,
        unitPrice: 95_000,
      },
      { type: "LABOR", description: "MO tôlerie", quantity: 6, unitPrice: 12_000 },
      { type: "LABOR", description: "MO peinture", quantity: 5, unitPrice: 12_000 },
    ] as const;
    await adminDb.repairOrderLine.createMany({
      data: lines.map((l, i) => ({
        organizationId: organization.id,
        repairOrderId: order.id,
        ...l,
        vatRate: 18,
        payer: "INSURANCE" as const,
        status: "DONE" as const,
        sortOrder: i,
      })),
    });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([
      { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    // ── Sinistre déclaré depuis l'OR ──
    await page.goto(`/ordres/${order.id}`);
    await page.getByRole("link", { name: /Ouvrir un dossier sinistre/ }).click();
    await expect(page).toHaveURL(/\/assurances\/sinistres\/nouveau\?or=/);
    await expect(page.getByText("OR-MAR-2026-00031")).toBeVisible();
    await page.getByLabel("Compagnie").selectOption({ label: "NSIA Assurances" });
    await page.getByLabel("N° sinistre assureur").fill("NSIA-2026-4471");
    await page.getByLabel("Date de l'accident").fill(`${YEAR}-01-12`);
    await typeAmount(page, "Franchise", "100000");
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await expect(page).toHaveURL(/\/assurances\/sinistres\/(?!nouveau)[^/]+$/, { timeout: 20_000 });
    const claimUrl = page.url();
    await expect(page.getByRole("heading", { name: `SIN-MAR-${YEAR}-00001` })).toBeVisible();
    await expect(page.getByText("○ Ouvert")).toBeVisible();

    // ── Expertise ──
    await page.getByRole("button", { name: "Planifier l'expert" }).click();
    const expert = page.getByRole("dialog", { name: "Planifier l'expert" });
    await expert.getByLabel("Expert", { exact: true }).fill("M. Diabaté");
    await expert.getByLabel("Visite prévue").fill(`${YEAR}-01-14T09:00`);
    await expert.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("🕑 Expert planifié")).toBeVisible();

    // ── Devis assurance prérempli depuis l'OR, transmis à l'assureur ──
    await page.getByRole("button", { name: "Créer le devis assurance" }).click();
    await page.getByRole("button", { name: "Marquer le devis envoyé" }).click();
    await expect(page.getByText("✉ Devis envoyé")).toBeVisible();
    await page.getByRole("button", { name: "Devis", exact: true }).click();
    await expect(page.getByText("653 720 FCFA").first()).toBeVisible();

    // ── Accord de l'assureur (montant du devis, franchise 100 000) ──
    await page.getByRole("button", { name: "Saisir l'accord" }).click();
    const approval = page.getByRole("dialog", { name: "Saisir l'accord" });
    await approval.getByLabel("Référence de l'accord").fill("ACC-NSIA-889");
    await approval.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("✓ Accordé")).toBeVisible();
    await page.getByRole("button", { name: "Résumé", exact: true }).click();
    await expect(page.getByTestId("insurer-share")).toHaveText("553 720 FCFA");
    await expect(page.getByTestId("customer-share")).toHaveText("100 000 FCFA");
    await noHorizontalScroll(page);

    // ── Facturer sans lettre d'accord : blocage explicite, puis pièce jointe ──
    await page.getByRole("button", { name: "Facturer le sinistre" }).click();
    await expect(
      page.getByText("Joignez le PV d'expertise ou la lettre d'accord avant de facturer."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByLabel("Type", { exact: true }).selectOption("approval_letter");
    await page.locator('input[type="file"]').setInputFiles({
      name: "accord.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% accord NSIA\n%%EOF\n"),
    });
    await expect(page.getByText("Lettre d'accord").last()).toBeVisible();
    await page.getByRole("button", { name: "Facturer le sinistre" }).click();
    await page.getByRole("button", { name: "Factures et paiements", exact: true }).click();
    const invoices = page.getByRole("link", { name: /Brouillon/ });
    await expect(invoices).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Part assureur.*553 720 FCFA/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Part client.*100 000 FCFA/ })).toBeVisible();
    await noHorizontalScroll(page);

    // ── Émission des deux factures ──
    for (const share of ["Part client", "Part assureur"]) {
      await page.goto(claimUrl);
      await page.getByRole("button", { name: "Factures et paiements", exact: true }).click();
      await page.getByRole("link", { name: new RegExp(`Brouillon.*${share}`) }).click();
      await expect(page).toHaveURL(/\/factures\/[^/]+$/);
      await page.getByRole("button", { name: "Émettre", exact: true }).click();
      await page.getByRole("button", { name: "Émettre la facture" }).click();
      await expect(page.getByTestId("invoice-number")).toHaveText(/^FAC-/);
    }
    const insurerInvoiceUrl = page.url();
    await page.goto(claimUrl);
    await expect(page.getByText("🧾 Facturé")).toBeVisible();

    // ── Suivi du règlement : encours assureur, puis virement reçu ──
    await page.goto("/assurances");
    await expect(page.getByRole("link", { name: /NSIA Assurances.*553 720 FCFA/ })).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto(insurerInvoiceUrl);
    await page.getByRole("button", { name: "Encaisser", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Encaisser" });
    await dialog.getByRole("button", { name: "Virement" }).click();
    await dialog.getByLabel("Référence").fill("VIR-NSIA-0042");
    await dialog.getByRole("button", { name: "Valider l'encaissement" }).click();
    await expect(dialog.getByText(/Paiement REC-.* enregistré\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Retour" }).click();
    await expect(page.getByTestId("invoice-balance")).toContainText("0 FCFA");

    await page.goto(claimUrl);
    await expect(page.getByText("◐ Partiellement réglé")).toBeVisible();
    await page.goto("/assurances/sinistres");
    await expect(
      page.getByRole("link", { name: new RegExp(`SIN-MAR-${YEAR}-00001`) }),
    ).toBeVisible();
    await noHorizontalScroll(page);
    await context.close();
  } finally {
    await cleanup(organization.id, user.id);
  }
});
