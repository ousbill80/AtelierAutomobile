import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M12 §12 — parcours principal (étape 6.1) : le gérant ouvre le tableau de bord sur mobile
// (390 px), choisit une période personnalisée, ouvre les rapports, filtre « Ventes » par
// période et par site, puis exporte en Excel : les totaux du fichier = ceux de l'écran.
// Les dates sont relatives à une période personnalisée qui encadre largement les factures :
// le test ne dépend ni du jour du mois ni de l'heure.

test.use({ viewport: { width: 390, height: 844 } });

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

test("gérant mobile : tableau de bord, période, rapport Ventes filtré, export Excel", async ({
  page,
  context,
}) => {
  const suffix = randomBytes(3).toString("hex");
  const organization = await adminDb.organization.create({
    data: { name: `E2E Garage Rapports ${suffix}`, onboardingCompletedAt: new Date() },
  });
  const yop = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const coc = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Cocody", code: "COC" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-rapports-${suffix}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const customer = await adminDb.customer.create({
    data: { organizationId: organization.id, displayName: "SOTRA Logistique", type: "COMPANY" },
  });
  const issuedAt = new Date(Date.now() - 2 * DAY);
  const invoice = (siteId: string, ht: number, n: string) =>
    adminDb.invoice.create({
      data: {
        organizationId: organization.id,
        siteId,
        customerId: customer.id,
        number: `FAC-E2E-${suffix}-${n}`,
        status: "ISSUED",
        issuedAt,
        dueDate: new Date(`${isoDay(issuedAt)}T00:00:00.000Z`),
        subtotal: ht,
        vatTotal: ht * 0.18,
        total: ht * 1.18,
        balance: ht * 1.18,
        lines: {
          create: [
            {
              organizationId: organization.id,
              type: "PART",
              description: "Plaquettes de frein",
              quantity: 1,
              unitPrice: ht,
              vatRate: 18,
              lineSubtotal: ht,
              lineVat: ht * 0.18,
              lineTotal: ht * 1.18,
            },
          ],
        },
      },
    });
  await invoice(yop.id, 250_000, "1");
  await invoice(coc.id, 150_000, "2");
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
  const from = isoDay(new Date(Date.now() - 40 * DAY));
  const to = isoDay(new Date(Date.now() + DAY));

  // 1. Tableau de bord, période personnalisée (URL partageable, US-M12-02).
  await page.goto("/tableau-de-bord?onglet=synthese");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await page.getByLabel("Période").selectOption({ label: "Personnalisée" });
  await page.getByLabel("Du", { exact: true }).fill(from);
  await page.getByLabel("Au", { exact: true }).fill(to);
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page).toHaveURL(new RegExp(`periode=perso&du=${from}&au=${to}`));
  await expect(page.getByTestId("kpi-card").filter({ hasText: "CA HT" }).first()).toContainText(
    "400 000 FCFA",
  );
  await noHorizontalScroll(page);

  // 2. Rapports → Ventes, filtre période + site.
  await page.getByRole("link", { name: "Tous les rapports" }).click();
  await expect(page.getByRole("heading", { name: "Rapports" })).toBeVisible();
  await page.getByRole("link", { name: /^Ventes/ }).click();
  await expect(page.getByRole("heading", { name: "Ventes" })).toBeVisible();
  await page.getByLabel("Du", { exact: true }).fill(from);
  await page.getByLabel("Au", { exact: true }).fill(to);
  await page.getByRole("button", { name: "Afficher" }).click();
  // La période par défaut (mois en cours) contient aussi les factures : le total seul ne prouve
  // pas que la période personnalisée est appliquée. On attend qu'elle soit dans l'URL avant de
  // changer de site, sinon le filtre « Site » repart des paramètres précédents (sans du/au).
  await expect(page).toHaveURL(new RegExp(`du=${from}&au=${to}`));
  await expect(page.getByTestId("report-totals")).toContainText("400 000 FCFA");
  await page.getByLabel("Site", { exact: true }).selectOption({ label: "Yopougon" });
  await expect(page).toHaveURL(new RegExp(`du=${from}&au=${to}.*site=${yop.id}`));
  await expect(page.getByTestId("report-totals")).toContainText("250 000 FCFA");
  await expect(page.getByTestId("report-count")).toContainText("sur 1");
  await noHorizontalScroll(page);

  // 3. Export Excel : nom de fichier §7, total HT identique à l'écran.
  await expect(page.getByRole("link", { name: "Excel" })).toHaveAttribute(
    "href",
    new RegExp(`from=${from}&to=${to}`),
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`ventes_${from}_${to}_Yopougon.xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const data = workbook.getWorksheet("Données")!;
  const header = (data.getRow(1).values as unknown[]).indexOf("HT");
  const total = data.getRow(data.rowCount);
  expect(total.getCell(1).value).toBe("Total");
  expect(total.getCell(header).value).toBe(250_000);
  const audit = await adminDb.auditLog.count({
    where: { organizationId: organization.id, action: "report.export" },
  });
  expect(audit).toBe(1);
});
