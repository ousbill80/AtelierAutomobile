import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// §12 — parcours principal M03 : le réceptionniste crée un RDV, vérifie la confirmation dans
// /dev/outbox, confirme le RDV, puis marque le client arrivé. La conversion en OR (M04) et la
// réservation portail (M14, PortalToken) ne sont pas encore construites : ce test couvre le
// parcours staff complet jusqu'à `ARRIVED`, écart documenté au message de commit.

async function createSignedInContext(browserContext: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage RDV ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: {
      organizationId: organization.id,
      name: "Atelier",
      code: `E2E${randomBytes(2).toString("hex")}`,
      openingHours: {
        mon: [
          ["07:30", "12:30"],
          ["13:30", "18:00"],
        ],
        tue: [
          ["07:30", "12:30"],
          ["13:30", "18:00"],
        ],
        wed: [
          ["07:30", "12:30"],
          ["13:30", "18:00"],
        ],
        thu: [
          ["07:30", "12:30"],
          ["13:30", "18:00"],
        ],
        fri: [
          ["07:30", "12:30"],
          ["13:30", "18:00"],
        ],
        sat: [["08:00", "13:00"]],
        sun: [],
      },
    },
  });
  await adminDb.bay.create({
    data: { organizationId: organization.id, siteId: site.id, name: "Pont 1", type: "LIFT" },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Owner", email: `e2e-rdv-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
      siteIds: [],
    },
  });
  const mechanicUser = await adminDb.user.create({
    data: {
      name: "Mécanicien E2E",
      email: `e2e-mecanicien-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
  // RG-M03-05 : la capacité de la demi-journée dépend des mécaniciens présents — sans aucun,
  // la capacité est nulle et toute création de RDV serait refusée (CAPACITY_EXCEEDED).
  await adminDb.membership.create({
    data: {
      organizationId: organization.id,
      userId: mechanicUser.id,
      role: "MECHANIC",
      siteIds: [],
    },
  });
  // RG-M11-10 : un 1er contact WhatsApp sans fenêtre 24 h ouverte exige un modèle approuvé ;
  // la confirmation de RDV (texte libre, pas de modèle) retombe donc sur SMS — fournisseur
  // configuré ici pour que le repli fonctionne, comme le prouve déjà messaging.spec.ts.
  await adminDb.channelConfig.createMany({
    data: [
      {
        organizationId: organization.id,
        channel: "WHATSAPP",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
      {
        organizationId: organization.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    ],
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organization.id,
      activeSiteId: site.id,
      isPinSession: false,
    },
  });
  await browserContext.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  return { organization, site };
}

test("parcours RDV : création, confirmation visible dans /dev/outbox, confirmer, client arrivé", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const { organization } = await createSignedInContext(context);

  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      type: "INDIVIDUAL",
      phone: `+225${randomBytes(4).readUInt32BE(0).toString().padStart(10, "0").slice(0, 10)}`,
    },
  });
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: "2547 GH 01",
      plateCompact: "2547GH01",
      make: "Toyota",
      model: "Corolla",
    },
  });

  // Prochain lundi 09:00 UTC (= heure locale, Africa/Abidjan) pour garantir un jour ouvré.
  const now = new Date();
  const daysUntilMonday = ((1 - now.getUTCDay() + 7) % 7) + 7; // la semaine suivante, marge de sécurité
  const nextMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 9, 0),
  );
  const localValue = nextMonday.toISOString().slice(0, 16);

  await page.goto("/rendez-vous/nouveau");
  await page.getByLabel("ID client").fill(customer.id);
  await page.getByLabel("ID véhicule (facultatif)").fill(vehicle.id);
  await page.getByLabel("Date et heure").fill(localValue);
  await page.getByLabel("Motif / doléances").fill("Révision complète");
  await page.getByRole("button", { name: "Enregistrer et envoyer la confirmation" }).click();

  await expect(page).toHaveURL(/\/rendez-vous\?created=/, { timeout: 15_000 });

  const appointment = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId: organization.id, customerId: customer.id },
  });
  expect(appointment.type).toBe("SERVICE");

  // La confirmation (RG-M03-08) part en transactionnel via la file M11.
  const phone = customer.phone!;
  // Repli SMS (RG-M11-10 : 1er contact WhatsApp sans modèle approuvé).
  const smsEntry = page.getByTestId(`outbox-entry-SMS-${phone}`);
  await page.goto("/dev/outbox");
  await expect(async () => {
    await page.reload();
    await expect(smsEntry).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000, intervals: [2000] });

  await page.goto("/rendez-vous");
  const card = page.getByTestId(`appointment-${appointment.id}`);
  await expect(card).toBeVisible();
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/trpc/appointment.confirm") && res.ok()),
    card.getByRole("button", { name: "Confirmer" }).click(),
  ]);
  await expect(card.getByText("Confirmé", { exact: true })).toBeVisible({ timeout: 10_000 });

  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/trpc/appointment.markArrived") && res.ok(),
    ),
    card.getByRole("button", { name: "Client arrivé" }).click(),
  ]);
  await expect(card.getByText("Arrivé", { exact: true })).toBeVisible({ timeout: 10_000 });

  const final = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  expect(final.status).toBe("ARRIVED");
  expect(final.arrivedAt).not.toBeNull();
});
