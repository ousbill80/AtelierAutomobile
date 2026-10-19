import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// §12 — parcours principal M09 : /creances → balance âgée → dossier Koné → paiement Wave
// 185 000 FCFA → facture « Payée », dossier « Soldé ». Les dossiers sont créés en base comme
// le ferait `receivables.age` (job de nuit couvert par apps/worker/src/jobs/receivablesAge.test.ts).

test("parcours créances : enregistrer un paiement ferme le dossier", async ({ page, context }) => {
  const organization = await adminDb.organization.create({
    data: { name: `E2E Garage Créances ${randomBytes(3).toString("hex")}` },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Owner",
      email: `e2e-creances-${randomBytes(4).toString("hex")}@example.com`,
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
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);

  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const customer = await adminDb.customer.create({
    data: { organizationId: organization.id, displayName: "Koné Ibrahim", phone: "+2250152770943" },
  });
  const due = new Date(
    `${new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  await adminDb.invoice.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      number: "FAC-2026-000412",
      status: "OVERDUE",
      issuedAt: due,
      dueDate: due,
      total: 185_000,
      balance: 185_000,
    },
  });
  const kase = await adminDb.collectionCase.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      status: "OPEN",
      totalDue: 185_000,
      overdueDue: 185_000,
      maxDaysOverdue: 12,
      oldestDueDate: due,
      anchorDate: due,
    },
  });

  await page.goto("/creances");
  await expect(page.getByText("Balance âgée")).toBeVisible();
  await expect(page.getByText("Koné Ibrahim").first()).toBeVisible();

  await page.goto(`/creances/${kase.id}`);
  await page.getByRole("button", { name: "Enregistrer un paiement" }).first().click();
  await page.getByLabel("Montant (FCFA)").fill("185000");
  await page.getByLabel("Mode de paiement").selectOption("WAVE");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();

  await expect(page.getByText("Soldé").first()).toBeVisible();
  const closed = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: kase.id } });
  expect(closed.status).toBe("CLOSED_PAID");
  const invoice = await adminDb.invoice.findFirstOrThrow({ where: { customerId: customer.id } });
  expect(invoice).toMatchObject({ status: "PAID", balance: 0 });
});
