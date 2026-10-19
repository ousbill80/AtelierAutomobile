import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { createPortalLink } from "@atelieros/planning";
import { expect, test, type Page } from "@playwright/test";

/**
 * M03 §12 — parcours principal : le réceptionnaire crée un RDV révision pour Kouassi Jean-Marc
 * (samedi 09:00, Pont 1) → confirmation visible dans /dev/outbox → déplacement sur Pont 2 11:00
 * (message « déplacé ») → le client ouvre le lien portail et confirme → « Client arrivé » puis,
 * M04 (réception / OR) n'étant pas encore construit, « Terminer sans OR » → RDV COMPLETED.
 */

const HOURS = {
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
  sat: [["08:00", "14:00"]],
  sun: [],
};

function nextSaturday(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7) + 7);
  return date.toISOString().slice(0, 10);
}

let organizationId: string;
let userId: string;
let sessionToken: string;
let customerId: string;

test.beforeAll(async () => {
  const organization = await adminDb.organization.create({
    data: {
      name: `Garage RDV E2E ${randomBytes(3).toString("hex")}`,
      timezone: "Africa/Abidjan",
      onboardingCompletedAt: new Date(),
    },
  });
  organizationId = organization.id;
  const site = await adminDb.site.create({
    data: { organizationId, name: "Atelier E2E", code: "E2E", openingHours: HOURS },
  });
  await adminDb.bay.create({
    data: { organizationId, siteId: site.id, name: "Pont 1", type: "LIFT", sortOrder: 1 },
  });
  await adminDb.bay.create({
    data: { organizationId, siteId: site.id, name: "Pont 2", type: "LIFT", sortOrder: 2 },
  });
  const mechanic = await adminDb.user.create({
    data: { name: "Konan Kra", email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: {
      organizationId,
      userId: mechanic.id,
      role: "MECHANIC",
      siteIds: [],
      skills: ["moteur"],
    },
  });
  const user = await adminDb.user.create({
    data: { name: "Yao Brou", email: `${randomBytes(4).toString("hex")}@example.com` },
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
      activeSiteId: site.id,
      isPinSession: false,
    },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId,
      type: "INDIVIDUAL",
      civility: "M",
      firstName: "Jean-Marc",
      lastName: "Kouassi",
      displayName: "Kouassi Jean-Marc",
      phone: "+2250747218890",
      hasWhatsapp: true,
    },
  });
  customerId = customer.id;
  await adminDb.vehicle.create({
    data: {
      organizationId,
      customerId,
      plate: "2547 GH 01",
      plateCompact: "2547GH01",
      make: "Toyota",
      model: "Corolla",
    },
  });
});

test.afterAll(async () => {
  await adminDb.message.deleteMany({ where: { organizationId } });
  await adminDb.notification.deleteMany({ where: { organizationId } });
  await adminDb.domainEvent.deleteMany({ where: { organizationId } });
  await adminDb.portalToken.deleteMany({ where: { organizationId } });
  await adminDb.auditLog.deleteMany({ where: { organizationId } });
  await adminDb.appointment.deleteMany({ where: { organizationId } });
  await adminDb.vehicle.deleteMany({ where: { organizationId } });
  await adminDb.customer.deleteMany({ where: { organizationId } });
  const memberships = await adminDb.membership.findMany({ where: { organizationId } });
  await adminDb.session.deleteMany({ where: { userId: { in: memberships.map((m) => m.userId) } } });
  await adminDb.membership.deleteMany({ where: { organizationId } });
  await adminDb.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await adminDb.bay.deleteMany({ where: { organizationId } });
  await adminDb.site.deleteMany({ where: { organizationId } });
  await adminDb.organization.delete({ where: { id: organizationId } });
});

async function signIn(page: Page) {
  await page
    .context()
    .addCookies([{ name: "atelieros_session", value: sessionToken, url: "http://localhost:3000" }]);
}

test("parcours principal : création, confirmation, déplacement, portail, arrivée, clôture", async ({
  page,
}) => {
  await signIn(page);
  const saturday = nextSaturday();

  // 1. Création depuis /rendez-vous/nouveau
  await page.goto("/rendez-vous/nouveau");
  await page.getByPlaceholder("Nom, téléphone ou plaque…").fill("Kouassi");
  await page.getByRole("button", { name: /Kouassi Jean-Marc/ }).click();
  await page.getByLabel("Véhicule").selectOption({ label: "Toyota Corolla — 2547 GH 01" });
  await page.getByLabel("Type").first().selectOption("SERVICE");
  await page.getByLabel("Source").selectOption("PHONE");
  await page.getByLabel("Date").fill(saturday);
  await page.getByLabel("Heure").fill("09:00");
  await page.getByLabel("Pont").selectOption({ label: "Pont 1" });
  await page.getByRole("button", { name: "Enregistrer et envoyer la confirmation" }).click();
  await expect(page.getByRole("dialog", { name: "Rendez-vous" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Rendez-vous" })).toContainText(
    "Kouassi Jean-Marc",
  );

  const created = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId, customerId },
  });
  expect(created.status).toBe("BOOKED");
  expect(created.startsAt.toISOString()).toBe(`${saturday}T09:00:00.000Z`);

  // 2. Confirmation WhatsApp dans l'outbox de développement
  await page.goto("/dev/outbox");
  await expect(
    page.getByText(/votre RDV chez Garage RDV E2E .* est confirmé le samedi/),
  ).toBeVisible();

  // 3. Déplacement sur Pont 2 à 11:00 → message « déplacé »
  await page.goto(`/rendez-vous?appointment=${created.id}`);
  const panel = page.getByRole("dialog", { name: "Rendez-vous" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Déplacer" }).click();
  const moveDialog = page.getByRole("dialog", { name: "Déplacer le rendez-vous" });
  await moveDialog.getByLabel("Nouvelle heure").fill("11:00");
  await moveDialog.getByLabel("Nouveau pont").selectOption({ label: "Pont 2" });
  await moveDialog.getByRole("button", { name: "Déplacer" }).click();
  await expect(page.getByText("Rendez-vous déplacé.")).toBeVisible();
  await expect
    .poll(async () =>
      (
        await adminDb.appointment.findUniqueOrThrow({ where: { id: created.id } })
      ).startsAt.toISOString(),
    )
    .toBe(`${saturday}T11:00:00.000Z`);
  await page.goto("/dev/outbox");
  await expect(page.getByText(/a été déplacé au samedi .* à 11:00/)).toBeVisible();

  // 4. Le client ouvre le lien portail et confirme
  const link = await createPortalLink({
    organizationId,
    scope: "APPOINTMENT",
    targetId: created.id,
    customerId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await page.context().clearCookies();
  await page.goto(`/p/${link.token}/rdv`);
  await expect(page.getByText("Votre rendez-vous")).toBeVisible();
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("Merci, votre rendez-vous est confirmé.")).toBeVisible();
  expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
    "CONFIRMED",
  );

  // 5. Jour J : « Client arrivé » puis « Terminer sans OR » (M04 non construit) → COMPLETED
  await signIn(page);
  await page.goto(`/rendez-vous?appointment=${created.id}`);
  await page
    .getByRole("dialog", { name: "Rendez-vous" })
    .getByRole("button", { name: "Client arrivé" })
    .click();
  await expect(page.getByText("Client arrivé.")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await adminDb.appointment.findUniqueOrThrow({ where: { id: created.id } })).status,
    )
    .toBe("ARRIVED");
  await page.goto(`/rendez-vous?appointment=${created.id}`);
  await page
    .getByRole("dialog", { name: "Rendez-vous" })
    .getByRole("button", { name: "Terminer sans OR" })
    .click();
  await page.getByLabel("Motif").fill("Contrôle gratuit");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect
    .poll(
      async () =>
        (await adminDb.appointment.findUniqueOrThrow({ where: { id: created.id } })).status,
    )
    .toBe("COMPLETED");

  // 6. Vue « Aujourd'hui » accessible
  await page.goto("/rendez-vous/aujourdhui");
  await expect(page.getByRole("heading", { name: "Rendez-vous du jour" })).toBeVisible();
});
