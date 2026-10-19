import { createHash, randomInt } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { adminDb } from "@atelieros/db";
import { generateInvitationToken, hashInvitationToken } from "../src/server/invitation-token";

const OTP_LENGTH = 6;
const PASSWORD = "Proprietaire2026!";
const MECHANIC_PASSWORD = "Mecanicien2026!";

/**
 * Le provider de messagerie "console" (dev) n'écrit nulle part de lisible pour un process
 * externe ; seul le hash SHA-256 du code OTP est persisté (`Verification.value`). L'espace
 * à 6 chiffres est assez petit pour être retrouvé par force brute depuis le test, sans avoir
 * besoin de la page /dev/outbox (prévue pour l'Étape 0.5, hors périmètre de cette étape).
 */
async function resolveOtp(identifier: string, purpose: string): Promise<string> {
  const row = await adminDb.verification.findFirst({
    where: { identifier: `${identifier}:${purpose}` },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new Error(`Aucun code OTP trouvé pour ${identifier}:${purpose}`);
  const max = 10 ** OTP_LENGTH;
  for (let i = 0; i < max; i++) {
    const code = i.toString().padStart(OTP_LENGTH, "0");
    if (createHash("sha256").update(code).digest("hex") === row.value) {
      return code;
    }
  }
  throw new Error("Code OTP introuvable par force brute.");
}

async function fillOtp(page: Page, code: string) {
  const inputs = page.locator(".otp-row input");
  for (let i = 0; i < code.length; i++) {
    await inputs.nth(i).fill(code[i]);
  }
}

test("créer un garage, inviter un mécanicien, vérifier l'accès paramètres refusé", async ({
  page,
}) => {
  const unique = `${Date.now()}-${randomInt(1000, 9999)}`;
  const ownerEmail = `owner-${unique}@test.atelieros.local`;
  const mechanicEmail = `mecanicien-${unique}@test.atelieros.local`;

  await test.step("inscription du gérant + vérification OTP", async () => {
    await page.goto("/inscription");
    await page.getByLabel("Votre nom").fill("Gérant Test");
    await page.getByLabel(/Email/).fill(ownerEmail);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Créer mon compte" }).click();

    await expect(page).toHaveURL(/\/verification/);
    const code = await resolveOtp(ownerEmail.toLowerCase(), "VERIFY");
    await fillOtp(page, code);
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page).toHaveURL(/\/connexion/);
  });

  await test.step("connexion (aucune organisation encore créée → pas d'OTP nouvel appareil)", async () => {
    // RG-M01 : l'OTP « nouvel appareil » exige une Organization + Membership actifs ; avant
    // l'onboarding (étape « garage » du wizard), le gérant n'en a pas encore, donc la connexion
    // aboutit directement, sans palier OTP.
    await page.getByLabel(/Téléphone ou email/).fill(ownerEmail);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL("/bienvenue");
  });

  let mechanicInvitationId: string | undefined;

  await test.step("assistant d'onboarding : garage, atelier, mode, invitation d'un mécanicien", async () => {
    await expect(page.getByRole("heading", { name: "Parlez-nous de votre garage" })).toBeVisible();
    await page.getByLabel("Nom du garage").fill("Garage Excellence Test");
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page.getByRole("heading", { name: "Votre premier site" })).toBeVisible();
    await page.getByLabel("Nom du site").fill("Site Principal");
    await page.getByLabel("Code du site").fill(`SITE${unique.slice(-4)}`);
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(
      page.getByRole("heading", { name: "Comment utilisez-vous AtelierOS ?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Gestion complète" }).click();

    await expect(page.getByRole("heading", { name: "Invitez votre équipe" })).toBeVisible();
    await page.getByRole("button", { name: "Ajouter un membre" }).click();
    await page.getByLabel("Nom").fill("Mécanicien Test");
    await page.getByLabel(/Email/).fill(mechanicEmail);
    await page.getByLabel("Rôle").selectOption("MECHANIC");
    await page.getByLabel("Canal").selectOption("EMAIL");

    const saveStepResponse = page.waitForResponse(
      (res) => res.url().includes("onboarding.saveStep") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Envoyer les invitations" }).click();
    const response = await saveStepResponse;
    const body = (await response.json()) as Array<{
      result: { data: { json: { invitationIds: string[] } } };
    }>;
    mechanicInvitationId = body[0].result.data.json.invitationIds[0];
    expect(mechanicInvitationId).toBeTruthy();

    await expect(page.getByRole("heading", { name: "Canaux de communication" })).toBeVisible();
    await page.getByRole("button", { name: "Plus tard" }).click();

    await expect(page.getByRole("heading", { name: "Données de démonstration" })).toBeVisible();
    await page.getByRole("button", { name: "Commencer avec un garage vide" }).click();

    await expect(page.getByRole("heading", { name: "Tout est prêt !" })).toBeVisible();
    await page.getByRole("button", { name: "Terminer la configuration" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText("Équipe")).toBeVisible();
  });

  await test.step("le mécanicien accepte son invitation", async () => {
    if (!mechanicInvitationId) throw new Error("Invitation du mécanicien introuvable.");
    const token = generateInvitationToken();
    await adminDb.invitation.update({
      where: { id: mechanicInvitationId },
      data: { tokenHash: hashInvitationToken(token) },
    });

    // Le gérant reste connecté dans ce même navigateur : on simule le changement d'utilisateur
    // en vidant sa session avant que le mécanicien ne rejoigne l'équipe.
    await page.context().clearCookies();

    await page.goto(`/invitation/${token}`);
    await expect(page.getByRole("heading", { name: /Rejoindre/ })).toBeVisible();
    await page.getByLabel("Choisissez un mot de passe").fill(MECHANIC_PASSWORD);
    await page.getByRole("button", { name: "Rejoindre l'équipe" }).click();
    await expect(page).toHaveURL(/\/connexion/);
  });

  await test.step("le mécanicien se connecte et n'a pas accès aux paramètres", async () => {
    // RG-M01-07 : DEFAULT_OTP_ON_NEW_DEVICE_ROLES ne couvre que OWNER/ACCOUNTANT par défaut,
    // donc un MECHANIC se connecte sans palier OTP nouvel appareil.
    await page.getByLabel(/Téléphone ou email/).fill(mechanicEmail);
    await page.locator('input[type="password"]').fill(MECHANIC_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText("Paramètres")).not.toBeVisible();

    // Le serveur refuse aussi l'accès direct : requirePermission("member:read") échoue pour
    // un MECHANIC, donc aucune donnée réelle de l'équipe ne doit apparaître sur cette URL.
    await page.goto("/parametres/equipe");
    await expect(page.getByText("Gérant Test")).not.toBeVisible();
  });
});
