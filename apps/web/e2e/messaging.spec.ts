import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// §12 — parcours principal M11 : configurer les canaux console, envoyer un message, simuler
// un échec « non WhatsApp » (repli SMS visible), simuler une réponse du client (boîte de
// réception) ; éditer un modèle SMS avec un caractère hors GSM-7 (compteur UCS-2).

async function createSignedInContext(browserContext: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage Messaging ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Owner", email: `e2e-msg-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  // Numéro unique par exécution : /dev/outbox liste les messages de toutes les organisations
  // (outil dev, cf. RG-M11-26) — un numéro fixe collisionnerait avec les exécutions précédentes.
  const phoneSuffix = randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 10);
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      type: "INDIVIDUAL",
      phone: `+225${phoneSuffix}`,
    },
  });
  // RG-M11-10 : un 1er contact WhatsApp (sans fenêtre 24 h ouverte) exige un modèle approuvé.
  await adminDb.messageTemplate.create({
    data: {
      organizationId: organization.id,
      key: "vt_j30",
      name: "VT — J-30",
      channel: "WHATSAPP",
      body: "Votre VT (2547 GH 01) expire le 30/11/2026.",
      whatsappStatus: "APPROVED",
      isActive: true,
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
  await browserContext.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  return { organization, user, customer };
}

test("parcours messagerie : canaux console, envoi, repli NOT_ON_WHATSAPP, réponse entrante, compteur SMS", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const { organization, customer } = await createSignedInContext(context);
  const phone = customer.phone!;

  // 1. Configurer les canaux WhatsApp et SMS en « console ».
  await page.goto("/parametres/canaux");
  await page.getByTestId("channel-WHATSAPP").getByRole("button", { name: "Configurer" }).click();
  await expect(page.getByTestId("channel-WHATSAPP").getByText("Connecté")).toBeVisible();

  await page.getByTestId("channel-SMS").getByRole("button", { name: "Configurer" }).click();
  await expect(page.getByTestId("channel-SMS").getByText("Connecté")).toBeVisible();

  // 2. Envoyer la relance VT au client, via le modèle WhatsApp approuvé.
  await page.goto("/messages");
  await page.getByRole("button", { name: "Nouveau message" }).click();
  await page.getByLabel("ID client").fill(customer.id);
  await page.getByRole("combobox").nth(1).selectOption({ label: "VT — J-30" });
  await page.getByRole("button", { name: "Envoyer" }).click();
  // Le formulaire se referme une fois l'envoi confirmé (évite de naviguer avant la fin de la requête).
  await expect(page.getByLabel("ID client")).toBeHidden({ timeout: 10_000 });

  // 3. Le message traité par le worker apparaît dans /dev/outbox (WhatsApp). Délai généreux :
  //    premier job après démarrage à froid du worker (connexion Redis, file BullMQ).
  const whatsappEntry = page.getByTestId(`outbox-entry-WHATSAPP-${phone}`);
  await page.goto("/dev/outbox");
  await expect(async () => {
    await page.reload();
    await expect(whatsappEntry).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000, intervals: [2000] });

  // 4. Simuler un échec « numéro non WhatsApp » : repli SMS visible dans l'outbox.
  //    On attend la réponse réseau avant de continuer (une navigation immédiate annulerait
  //    la requête tRPC en vol).
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/trpc/devOutbox.simulate") && res.ok()),
    whatsappEntry.getByRole("button", { name: "Échec : numéro non WhatsApp" }).click(),
  ]);
  await expect(whatsappEntry).toContainText("FAILED", { timeout: 20_000 });
  const smsEntry = page.getByTestId(`outbox-entry-SMS-${phone}`);
  await expect(smsEntry).toBeVisible({ timeout: 20_000 });

  const updatedCustomer = await adminDb.customer.findFirst({ where: { id: customer.id } });
  expect(updatedCustomer?.hasWhatsapp).toBe(false);

  // 5. Simuler la réponse du client sur le repli SMS : apparaît dans la boîte de réception.
  await smsEntry.getByPlaceholder("Réponse entrante du client…").fill("Oui samedi matin");
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/trpc/devOutbox.simulateReply") && res.ok(),
    ),
    smsEntry.getByRole("button", { name: "Simuler réponse" }).click(),
  ]);

  await page.goto("/messages");
  await expect(page.getByText("Kouassi Jean-Marc")).toBeVisible();
  await expect(page.getByText("1 non lu(s)").first()).toBeVisible();

  await page.getByText("Kouassi Jean-Marc").click();
  await expect(page.getByText("Oui samedi matin")).toBeVisible();

  // 6. Modèle SMS avec un caractère hors GSM-7 : compteur UCS-2.
  await adminDb.messageTemplate.create({
    data: {
      organizationId: organization.id,
      key: "e2e_sms_template",
      name: "Modèle SMS E2E",
      channel: "SMS",
      body: "Reglement",
      isActive: true,
    },
  });
  await page.goto("/parametres/modeles");
  await page.getByRole("button", { name: /Modèle SMS E2E/ }).click();
  await page.locator("textarea").first().fill("Règlement rêvé");
  await expect(page.getByText(/UCS2/)).toBeVisible();
});
