import { createHash, randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";

// M15 étape 6.5 — parcours principal : le gérant atteint la limite de sites de l'offre STARTER,
// passe à l'offre PRO (fournisseur d'abonnement `fake`), crée son 2e site, puis lance l'export
// complet (OTP) et télécharge l'archive préparée par apps/worker (`org.export`).

const orgIds: string[] = [];
const userIds: string[] = [];

test.afterAll(async () => {
  await deleteTestOrganizations(orgIds, userIds);
});

/** Le provider `console` ne persiste que le hash du code : retrouvé par force brute. */
async function resolveSecurityCode(email: string): Promise<string> {
  const row = await adminDb.verification.findFirstOrThrow({
    where: { identifier: `${email}:SENSITIVE_ACTION` },
    orderBy: { createdAt: "desc" },
  });
  for (let i = 0; i < 1_000_000; i++) {
    const code = i.toString().padStart(6, "0");
    if (createHash("sha256").update(code).digest("hex") === row.value) return code;
  }
  throw new Error("Code introuvable.");
}

async function fillOtp(page: Page, code: string) {
  const inputs = page.locator(".otp-row input");
  for (let i = 0; i < code.length; i++) await inputs.nth(i).fill(code[i]!);
}

test("abonnement : limite atteinte, passage à PRO, export complet téléchargé", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  const suffix = randomBytes(3).toString("hex");
  const organization = await adminDb.organization.create({
    data: { name: `E2E Garage Abonnement ${suffix}`, onboardingCompletedAt: new Date() },
  });
  orgIds.push(organization.id);
  await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const email = `e2e-abonnement-${randomBytes(4).toString("hex")}@example.com`;
  const user = await adminDb.user.create({ data: { name: "E2E Gérant", email } });
  userIds.push(user.id);
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: `Client Export ${suffix}`,
      phone: "+2250701020304",
    },
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

  await test.step("la limite de sites de l'offre STARTER est appliquée", async () => {
    await page.goto("/parametres/sites");
    await page.getByRole("button", { name: "Ajouter un site" }).first().click();
    await page.getByLabel("Nom du site").fill("Cocody");
    await page.getByLabel("Code").fill("COC");
    await page.getByRole("dialog").getByRole("button", { name: "Ajouter un site" }).click();
    await expect(
      page.getByText("Votre offre STARTER permet 1 site. Passez à l'offre PRO."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Voir les offres" }).click();
  });

  await test.step("jauges puis passage à l'offre PRO", async () => {
    await expect(page).toHaveURL(/\/parametres\/abonnement/);
    await expect(page.getByTestId("current-plan")).toHaveText("Offre actuelle : Starter");
    await expect(page.getByTestId("gauge-activeSites")).toContainText("1/1");
    await expect(page.getByTestId("gauge-activeSites")).toContainText("Limite atteinte");
    await page.getByRole("button", { name: "Choisir l'offre Pro" }).click();
    await page
      .getByLabel("Message pour l'équipe commerciale")
      .fill("Ouverture d'un atelier à Cocody");
    await page.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(page.getByText("Votre offre est maintenant Pro.")).toBeVisible();
    await expect(page.getByTestId("current-plan")).toHaveText("Offre actuelle : Pro");
    await expect(page.getByTestId("gauge-activeSites")).toContainText("1/3");
  });

  await test.step("le deuxième site peut être créé", async () => {
    await page.goto("/parametres/sites");
    await page.getByRole("button", { name: "Ajouter un site" }).first().click();
    await page.getByLabel("Nom du site").fill("Cocody");
    await page.getByLabel("Code").fill("COC");
    await page.getByRole("dialog").getByRole("button", { name: "Ajouter un site" }).click();
    await expect(page.getByRole("cell", { name: "Cocody" })).toBeVisible();
  });

  await test.step("export complet confirmé par OTP, puis archive téléchargée", async () => {
    await page.goto("/parametres/donnees");
    await page.getByRole("button", { name: "Exporter toutes mes données" }).click();
    await page.getByRole("button", { name: "Recevoir le code" }).click();
    await expect(page.getByText(/Code envoyé à/)).toBeVisible();
    await fillOtp(page, await resolveSecurityCode(email));
    await page.getByRole("button", { name: "Confirmer" }).click();
    await expect(page.getByText("Export lancé")).toBeVisible();

    // Traité par apps/worker (file « exports ») ; la page se rafraîchit seule.
    const download = page.getByTestId("export-download");
    await expect(download).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("list", { name: "Exporter toutes mes données" })).toContainText(
      "Prête",
    );
    const href = await download.getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.subarray(0, 2).toString()).toBe("PK"); // archive ZIP
  });

  const actions = (
    await adminDb.auditLog.findMany({
      where: { organizationId: organization.id },
      select: { action: true },
    })
  ).map((a) => a.action);
  expect(actions).toEqual(
    expect.arrayContaining(["plan.changed", "org.export", "org.export_downloaded"]),
  );
});
