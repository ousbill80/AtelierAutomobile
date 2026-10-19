import { randomBytes } from "node:crypto";
import path from "node:path";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { test, expect } from "@playwright/test";

// RG-M13-* — parcours principal du module Import fichier (étape 1.3) : upload
// d'un fichier réel contenant des doublons et des lignes en erreur, correction
// de la correspondance de colonnes, vérification, simulation (en ignorant les
// erreurs) puis import effectif. Les compteurs attendus (create=23, skip=3,
// error=3, update=0, unchanged=0) ont été vérifiés empiriquement contre le
// pipeline réel pour `tests/fixtures/import-garage.xlsx` (29 lignes, 3 en
// erreur bloquante, 3 doublons fusionnés).
const FIXTURE_PATH = path.resolve(__dirname, "../../../tests/fixtures/import-garage.xlsx");

let organizationId: string;
let userId: string;
let sessionToken: string;

test.beforeAll(async () => {
  const organization = await adminDb.organization.create({
    data: { name: `Garage Import E2E ${randomBytes(4).toString("hex")}` },
  });
  organizationId = organization.id;

  const user = await adminDb.user.create({
    data: { name: "Manager Import E2E", email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  userId = user.id;

  await adminDb.membership.create({
    data: { organizationId, userId, role: "MANAGER", siteIds: [] },
  });

  sessionToken = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId,
      token: sessionToken,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
});

test.afterAll(async () => {
  const jobs = await adminDb.importJob.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const jobIds = jobs.map((j) => j.id);
  await adminDb.importRowError.deleteMany({ where: { importJobId: { in: jobIds } } });
  await adminDb.auditLog.deleteMany({ where: { organizationId } });
  await adminDb.importJob.deleteMany({ where: { organizationId } });
  await adminDb.customer.deleteMany({ where: { organizationId } });
  await adminDb.session.deleteMany({ where: { userId } });
  await adminDb.membership.deleteMany({ where: { organizationId } });
  await adminDb.user.delete({ where: { id: userId } });
  await adminDb.organization.delete({ where: { id: organizationId } });
});

/** Renvoie le conteneur (ligne) de correspondance de colonne pour un en-tête donné. */
function mappingRowFor(page: import("@playwright/test").Page, columnText: string) {
  return page
    .getByText(columnText, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-md') and contains(@class,'border')][1]");
}

test("parcours complet import fichier : dépôt, correspondance, vérification, simulation, import", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "atelieros_session",
      value: sessionToken,
      url: "http://localhost:3000",
    },
  ]);

  await page.goto("/import/fichier");
  await expect(page.getByRole("heading", { name: "Importer un fichier" })).toBeVisible();

  // Étape 1 — dépôt du fichier.
  await page.locator("#import-file-input").setInputFiles(FIXTURE_PATH);

  // Étape 2 — lecture du fichier (analyse automatique).
  await expect(page.getByRole("heading", { name: "Lecture du fichier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 3 — correspondance des colonnes. Les en-têtes "Nom & Prénoms",
  // "Téléphone", "Email" et "NCC" sont correctement suggérés par synonyme ;
  // "Téléphone 2" est mal associé par défaut à "Client — Téléphone" (inclusion
  // de "telephone" dans "telephone 2") et doit être corrigé manuellement vers
  // "Client — Autre téléphone".
  await expect(page.getByRole("heading", { name: "Correspondance des colonnes" })).toBeVisible();
  await mappingRowFor(page, "Téléphone 2").locator("select").selectOption("customer.phone2");
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 4 — vérification des lignes : des erreurs bloquantes doivent apparaître.
  await expect(page.getByRole("heading", { name: "Vérification des lignes" })).toBeVisible();
  await expect(page.locator('[data-severity="ERROR"]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 5 — simulation : on ignore les lignes en erreur pour importer le reste.
  await expect(page.getByRole("heading", { name: "Simulation" })).toBeVisible();
  const skipErrorsCheckbox = page.getByLabel("Ignorer les lignes en erreur et importer le reste");
  await expect(skipErrorsCheckbox).toBeVisible({ timeout: 20_000 });
  await skipErrorsCheckbox.check();
  await page.getByRole("button", { name: "Continuer" }).click();

  // Étape 6 — import en cours, puis bascule automatique vers le résumé (étape 7).
  await expect(page.getByRole("heading", { name: "Import terminé" })).toBeVisible({
    timeout: 30_000,
  });

  const values = await page.locator("div.grid.grid-cols-2 .tabular").allTextContents();
  expect(values).toEqual(["23", "0", "0", "3", "3"]);
});
