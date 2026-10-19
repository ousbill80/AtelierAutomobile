import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// §12 — parcours principal M02 : créer un client + véhicule, saisir un km, voir l'estimation
// de révision, enregistrer une VT, détecter un doublon et le fusionner.

async function createSignedInContext(browserContext: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Owner", email: `e2e-${randomBytes(4).toString("hex")}@example.com` },
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
  await browserContext.addCookies([
    {
      name: "atelieros_session",
      value: token,
      domain: "localhost",
      path: "/",
    },
  ]);
  return { organization, user };
}

test("parcours client + véhicule : création, km, révision, VT, doublon, fusion", async ({
  page,
  context,
}) => {
  const { organization } = await createSignedInContext(context);

  await page.goto("/clients/nouveau");
  await page.getByLabel("Nom", { exact: true }).fill("Kouassi");
  await page.getByLabel("Prénom(s)").fill("Jean-Marc");
  await page.getByLabel("Téléphone").fill("07 47 21 88 90");
  await page.getByLabel("Plaque").fill("2547gh01");
  await page.getByLabel("Marque").fill("Toyota");
  await page.getByLabel("Modèle").fill("Corolla");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}$/);
  await expect(page.getByRole("heading", { name: "Kouassi Jean-Marc" })).toBeVisible();

  await page.getByRole("link", { name: /2547 GH 01/ }).click();
  await expect(page).toHaveURL(/\/vehicules\/[a-z0-9]{20,}$/);

  await page.getByLabel("Nouveau relevé").fill("48200");
  await page.getByRole("button", { name: "Saisir le km" }).click();
  await expect(page.getByText(/48200 km|48 200 km/)).toBeVisible();

  await page.getByLabel("VT effectuée le").fill("2026-10-20");
  await page.getByRole("button", { name: "VT effectuée" }).click();
  await expect(page.getByText(/À jour|Bientôt/)).toBeVisible();

  // Doublon : même téléphone, nom presque identique.
  await page.goto("/clients/nouveau");
  await page.getByLabel("Nom", { exact: true }).fill("Kouasi");
  await page.getByLabel("Prénom(s)").fill("Jean Marc");
  await page.getByLabel("Téléphone").fill("07 47 21 88 90");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/appartient déjà/)).toBeVisible();

  await page.getByLabel("Motif pour créer quand même").fill("numéro partagé");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}$/);

  await page.goto("/clients/doublons");
  await expect(page.getByText(/Kouassi Jean-Marc|Kouasi Jean Marc/)).toBeVisible();

  // Le nom du client absorbé (source) varie selon l'ordre lexical des id (RG-M02-08) :
  // on le lit dans le message du prompt plutôt que de le supposer.
  page.once("dialog", (dialog) => {
    const match = /« (.+) »/.exec(dialog.message());
    void dialog.accept(match?.[1] ?? "");
  });
  await page.getByRole("button", { name: "Fusionner" }).first().click();
  await expect(page.getByText("Aucun doublon détecté pour l'instant.")).toBeVisible();

  const members = await adminDb.membership.findMany({ where: { organizationId: organization.id } });
  await adminDb.vehicleEvent.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.mileageReading.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.vehicle.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.customer.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.session.deleteMany({ where: { userId: { in: members.map((m) => m.userId) } } });
  await adminDb.membership.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await adminDb.auditLog.deleteMany({ where: { organizationId: organization.id } });
  await adminDb.organization.delete({ where: { id: organization.id } });
});
