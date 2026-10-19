import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// Reprise des apports de d2045c5 (M02/M10) : contacts d'un client, recherche globale du
// bandeau (RG-M02-19) et page « Résultats des relances ».

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

test("contacts d'une entreprise, recherche globale et résultats des relances", async ({
  page,
  context,
}) => {
  const { organization } = await createSignedInContext(context);
  const suffix = randomBytes(2).toString("hex");
  const company = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      type: "COMPANY",
      companyName: `SOTRA Logistique ${suffix}`,
      displayName: `SOTRA Logistique ${suffix}`,
      phone: "+2252720000000",
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: company.id,
      plate: "3315 KL 01",
      plateCompact: "3315KL01",
      plateType: "STANDARD",
      make: "Toyota",
      model: "Hilux",
      usage: "UTILITY",
    },
  });
  const rule = await adminDb.reminderRule.create({
    data: {
      organizationId: organization.id,
      type: "INSPECTION",
      name: "Visite technique",
      steps: [
        {
          key: "J-30",
          label: "1er rappel",
          offsetDays: -30,
          templateKey: "vt_j30",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00", preferredTime: "09:00" },
      conditions: {},
      stopOn: [],
    },
  });
  const now = new Date();
  for (const [index, status] of (["SENT", "FAILED"] as const).entries()) {
    await adminDb.reminder.create({
      data: {
        organizationId: organization.id,
        ruleId: rule.id,
        type: "INSPECTION",
        stepKey: "J-30",
        customerId: company.id,
        vehicleId: vehicle.id,
        dueDate: now,
        scheduledFor: now,
        status,
        channel: "WHATSAPP",
        sentAt: status === "SENT" ? now : null,
        outcome: status === "SENT" ? "APPOINTMENT_BOOKED" : null,
        outcomeAt: status === "SENT" ? now : null,
        dedupeKey: `e2e:${company.id}:${index}`,
        sequenceKey: `e2e:${company.id}`,
      },
    });
  }

  // --- Contacts (fiche client) ---
  await page.goto(`/clients/${company.id}`);
  await expect(page.getByRole("heading", { name: company.displayName })).toBeVisible();
  // Attendre l'hydratation : un clic sur le HTML rendu côté serveur serait perdu.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Aucun contact.")).toBeVisible();

  await page.getByRole("button", { name: "Ajouter un contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom").fill("Diabaté Moussa");
  await dialog.getByLabel(/^Fonction/).fill("Responsable flotte");
  await dialog.getByLabel(/^Téléphone \(/).fill("07 08 99 99 99");
  await dialog.getByLabel(/Reçoit les relances/).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Diabaté Moussa")).toBeVisible();
  await expect(page.getByText("+2250708999999")).toBeVisible();
  await expect(page.getByText("Reçoit les relances", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("dialog").getByLabel("Contact principal").check();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Contact principal", { exact: true })).toBeVisible();

  // --- Recherche globale (bandeau) : par téléphone du contact, puis par plaque ---
  const searchBox = page.getByRole("searchbox", { name: "Recherche globale" });
  await searchBox.fill("0708999999");
  await expect(page.getByText("Contact : Diabaté Moussa")).toBeVisible();
  await searchBox.fill("3315 kl 01");
  await page.getByRole("option", { name: /3315 KL 01 — Toyota Hilux/ }).click();
  await expect(page).toHaveURL(new RegExp(`/vehicules/${vehicle.id}$`));

  // --- Suppression du contact ---
  await page.goto(`/clients/${company.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Aucun contact.")).toBeVisible();

  // --- Résultats des relances ---
  await page.goto("/relances/resultats");
  await expect(page.getByRole("heading", { name: "Résultats des relances" })).toBeVisible();
  await expect(page.getByLabel("Envoyée : 1")).toBeVisible();
  await expect(page.getByLabel("Échec : 1")).toBeVisible();
  await expect(page.getByText("RDV pris").first()).toBeVisible();
  await expect(page.getByRole("link", { name: company.displayName }).first()).toBeVisible();

  await page.waitForLoadState("networkidle");
  await page.getByLabel("Statut").selectOption("FAILED");
  await expect(page.getByLabel("Envoyée : 1")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
