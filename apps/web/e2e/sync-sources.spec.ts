import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { test, expect } from "@playwright/test";

// M13 partie 2 (étape 6.4) — parcours principal de la synchronisation par connexion directe :
// le gérant (mobile 390 px) crée une source pointant vers la base de son ancien logiciel
// (ici le PostgreSQL local joue ce rôle), teste la connexion, prévisualise la requête,
// synchronise et voit le client importé et l'exécution dans le journal.
test.use({ viewport: { width: 390, height: 844 } });

const dbUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost:5432/x");

test("gérant : nouvelle source SQL, test, aperçu, synchronisation", async ({ page, context }) => {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Synchro ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-sync-${randomBytes(4).toString("hex")}@example.com` },
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
  const phone = `07${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;

  await page.goto("/import");
  await page.getByRole("link", { name: "Gérer les sources" }).click();
  await expect(page.getByText("Aucune source de synchronisation")).toBeVisible();
  await page.getByRole("link", { name: "Nouvelle source" }).click();

  await page.getByLabel("Nom de la source").fill("Logiciel de l'atelier");
  await page.getByLabel("Type de base").selectOption("postgres");
  await page.getByLabel("Hôte").fill(dbUrl.hostname);
  await page.getByLabel("Port").fill(dbUrl.port || "5432");
  await page.getByLabel("Base", { exact: true }).fill(dbUrl.pathname.slice(1));
  await page.getByLabel("Utilisateur").fill(decodeURIComponent(dbUrl.username));
  await page.getByLabel("Mot de passe").fill(decodeURIComponent(dbUrl.password));
  await page
    .getByLabel("Clients")
    .fill(`SELECT 'Client E2E Synchro' AS "displayName", '${phone}' AS phone`);

  await page.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(page.getByRole("status")).toContainText("tables visibles");

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/import\/sources\/(?!nouvelle)[\w-]+$/);
  await expect(
    page.getByRole("heading", { name: /Source « Logiciel de l'atelier »/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Prévisualiser 20 lignes" }).click();
  await expect(page.getByRole("cell", { name: "Client E2E Synchro" })).toBeVisible();

  await page.getByRole("button", { name: "Synchroniser maintenant" }).click();
  await expect(page.getByRole("status")).toContainText(/Synchronisation (terminée|lancée)/);
  await expect
    .poll(
      () =>
        adminDb.customer.count({
          where: { organizationId: organization.id, displayName: "Client E2E Synchro" },
        }),
      { timeout: 30_000 },
    )
    .toBe(1);
  await page.reload();
  await expect(page.getByText("Journal des 30 dernières exécutions")).toBeVisible();
  await expect(page.getByText("Terminé")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
