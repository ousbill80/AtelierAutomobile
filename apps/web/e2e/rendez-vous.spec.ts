import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  addDaysToKey,
  computeSessionAbsoluteExpiry,
  localDateKey,
  zonedInstant,
} from "@atelieros/core";
import { adminDb, issuePortalToken } from "@atelieros/db";
import { handleAppointmentEvent } from "../../worker/src/jobs/appointments";
import { getMessagesQueue } from "../../worker/src/queues/messages";

// M03 §12 — parcours principal : le réceptionnaire crée un RDV révision pour Kouassi Jean-Marc
// samedi 09:00 Pont 1 → confirmation visible dans /dev/outbox → glisse le RDV sur Pont 2 11:00
// (message « déplacé ») → le client ouvre le lien du portail et confirme → « Client arrivé »
// ouvre la réception M04 pré-remplie → l'OR livré fait passer le RDV COMPLETED.
//
// La réception M04 est construite par l'étape 3.2 : ce test vérifie l'URL de réception
// (appointmentId) et simule l'OR livré en appelant directement le consommateur d'événements
// du worker (sondage toutes les 2 min, trop lent pour un E2E).

const TZ = "Africa/Abidjan";

/**
 * M03 RG-M03-08 : hors de 07:00-22:00 (heure réelle d'Abidjan), un message transactionnel est
 * mis en file avec un délai jusqu'à 07:00. Pour que le test ne dépende pas de l'heure à
 * laquelle il tourne, on avance les jobs différés des messages de son organisation : l'envoi
 * passe ensuite par le vrai worker et le fournisseur console, comme en journée.
 */
async function promoteDelayedMessages(organizationId: string): Promise<void> {
  const messages = await adminDb.message.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const queue = getMessagesQueue();
  for (const { id } of messages) {
    const job = await queue.getJob(id);
    if (job && (await job.isDelayed())) await job.promote();
  }
}
const SAT_HOURS = {
  mon: [["07:30", "18:00"]],
  tue: [["07:30", "18:00"]],
  wed: [["07:30", "18:00"]],
  thu: [["07:30", "18:00"]],
  fri: [["07:30", "18:00"]],
  sat: [["08:00", "14:00"]],
  sun: [],
};
const SLOT_PX = 16;

function nextSaturday(): string {
  let day = addDaysToKey(localDateKey(new Date(), TZ), 2);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 6) day = addDaysToKey(day, 1);
  return day;
}

async function setup(context: BrowserContext) {
  const suffix = randomBytes(3).toString("hex");
  const organization = await adminDb.organization.create({
    data: { name: `Garage Excellence Auto ${suffix}`, onboardingCompletedAt: new Date() },
  });
  const site = await adminDb.site.create({
    data: {
      organizationId: organization.id,
      name: "Atelier Yopougon",
      code: "YOP",
      openingHours: SAT_HOURS,
    },
  });
  const pont1 = await adminDb.bay.create({
    data: { organizationId: organization.id, siteId: site.id, name: "Pont 1", sortOrder: 1 },
  });
  const pont2 = await adminDb.bay.create({
    data: { organizationId: organization.id, siteId: site.id, name: "Pont 2", sortOrder: 2 },
  });
  await adminDb.channelConfig.create({
    data: {
      organizationId: organization.id,
      channel: "SMS",
      provider: "console",
      isActive: true,
      priority: 1,
      credentials: "",
    },
  });
  const user = await adminDb.user.create({
    data: { name: "Réceptionnaire E2E", email: `e2e-rdv-${suffix}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "ADVISOR", siteIds: [] },
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
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  // Numéro unique : /dev/outbox liste les messages de toutes les organisations.
  const phone = `+22507${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      lastName: "Kouassi",
      firstName: "Jean-Marc",
      civility: "M",
      phone,
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
  return { organization, site, pont1, pont2, customer, vehicle, phone };
}

async function openDay(page: Page, day: string) {
  await page.goto("/rendez-vous");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="date"]').first().fill(day);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("day-grid")).toBeVisible();
}

test("parcours RDV : création, confirmation, déplacement, portail, arrivée, OR livré", async ({
  page,
  context,
  browser,
}) => {
  // Parcours long (planning, glisser-déposer, portail, réception) : 30 s par défaut ne suffisent
  // pas sur un serveur encore froid.
  test.setTimeout(90_000);
  const { organization, site, pont1, pont2, customer, vehicle, phone } = await setup(context);
  const SAT = nextSaturday();

  // 1. Clic sur le créneau libre samedi 09:00, Pont 1 → panneau de création prérempli.
  await openDay(page, SAT);
  const pont1Column = page.locator(`[data-column="${pont1.id}"]`);
  await pont1Column.click({ position: { x: 40, y: ((9 * 60 - 8 * 60) / 15) * SLOT_PX + 4 } });
  const form = page.getByRole("dialog", { name: "Nouveau rendez-vous" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Heure")).toHaveValue("09:00");
  await form.getByLabel("Nom, téléphone ou plaque").fill("Kouassi");
  await form.getByRole("button", { name: /Kouassi Jean-Marc/ }).click();
  await expect(form.getByTestId("selected-customer")).toHaveText("Kouassi Jean-Marc");
  await expect(form.getByLabel("Durée (min)")).toHaveValue("90");
  await form.getByRole("button", { name: "Enregistrer et envoyer la confirmation" }).click();
  await expect(form).toBeHidden({ timeout: 10_000 });

  const card = page.locator('[data-testid="appt-card"]').filter({ hasText: "Kouassi Jean-Marc" });
  await expect(pont1Column.locator('[data-testid="appt-card"]')).toHaveCount(1);
  const appointment = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId: organization.id },
  });
  expect(appointment).toMatchObject({
    status: "BOOKED",
    bayId: pont1.id,
    vehicleId: vehicle.id,
    type: "SERVICE",
  });
  expect(appointment.startsAt).toEqual(zonedInstant(SAT, 9 * 60, TZ));
  expect(appointment.endsAt).toEqual(zonedInstant(SAT, 10 * 60 + 30, TZ));

  // 2. La confirmation (transactionnelle, via M11) apparaît dans /dev/outbox.
  const outbox = await context.newPage();
  const entry = outbox.getByTestId(`outbox-entry-SMS-${phone}`).first();
  await outbox.goto("/dev/outbox");
  await expect(async () => {
    await promoteDelayedMessages(organization.id);
    await outbox.reload();
    await expect(entry).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 40_000, intervals: [2000] });
  await expect(
    outbox.getByText(/votre RDV chez Garage Excellence Auto .* est confirmé le samedi/).first(),
  ).toBeVisible();
  await outbox.close();

  // 3. Glisser-déposer sur Pont 2 à 11:00 → message « déplacé » (case cochée par défaut).
  const pont2Column = page.locator(`[data-column="${pont2.id}"]`);
  const box = await card.boundingBox();
  const grab = (box?.height ?? 0) / 2;
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("appointment.update") && res.ok()),
    card.dragTo(pont2Column, {
      targetPosition: { x: 40, y: ((11 * 60 - 8 * 60) / 15) * SLOT_PX + grab },
    }),
  ]);
  await expect(pont2Column.locator('[data-testid="appt-card"]')).toHaveCount(1);
  const moved = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  expect(moved.bayId).toBe(pont2.id);
  expect(moved.startsAt).toEqual(zonedInstant(SAT, 11 * 60, TZ));
  const movedMessage = await adminDb.message.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      idempotencyKey: { startsWith: `appt:${appointment.id}:moved` },
    },
  });
  expect(movedMessage.body).toContain("à 11:00");

  // 4. Le client ouvre le lien du portail (sans session) et confirme.
  const confirmation = await adminDb.message.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      idempotencyKey: { startsWith: `appt:${appointment.id}:confirm` },
    },
  });
  const link = /https?:\/\/[^\s]+\/p\/[\w-]+\/rdv/.exec(confirmation.body)![0];
  const customerContext = await browser.newContext();
  const portal = await customerContext.newPage();
  await portal.goto(new URL(link).pathname);
  await portal.waitForLoadState("networkidle");
  await expect(portal.getByTestId("portal-date")).toContainText("11:00");
  await portal.getByRole("button", { name: "Je confirme" }).click();
  await expect(portal.getByTestId("portal-done")).toHaveText(
    "Merci, votre rendez-vous est confirmé.",
  );
  await customerContext.close();
  expect(
    await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
  ).toMatchObject({
    status: "CONFIRMED",
    confirmedVia: "portal",
  });

  // 5. Le jour J : « Client arrivé » ouvre la réception M04 pré-remplie (appointmentId).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="date"]').first().fill(SAT);
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-appointment-id="${appointment.id}"]`).click();
  const panel = page.getByRole("dialog", { name: "Rendez-vous" });
  await expect(panel.getByTestId("panel-when")).toContainText("11:00");
  await panel.getByRole("button", { name: "Client arrivé" }).click();
  await page.waitForURL(`**/ordres/reception?appointmentId=${appointment.id}`);
  expect(
    (await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status,
  ).toBe("ARRIVED");

  // 6. L'OR (M04) est livré → le RDV passe COMPLETED (événement repair_order.status_changed).
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: `OR-YOP-E2E-${randomBytes(2).toString("hex")}`,
      customerId: customer.id,
      vehicleId: vehicle.id,
      appointmentId: appointment.id,
      status: "DELIVERED",
    },
  });
  await handleAppointmentEvent(
    {
      id: "e2e",
      organizationId: organization.id,
      type: "repair_order.created",
      payload: { repairOrderId: order.id, appointmentId: appointment.id },
    },
    new Date(),
  );
  await handleAppointmentEvent(
    {
      id: "e2e",
      organizationId: organization.id,
      type: "repair_order.status_changed",
      payload: { repairOrderId: order.id, newStatus: "DELIVERED" },
    },
    new Date(),
  );
  const completed = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  expect(completed).toMatchObject({ status: "COMPLETED", repairOrderId: order.id });
});

test("mobile 390 px : planning (liste), accueil du jour et portail sans défilement horizontal", async ({
  page,
  context,
  browser,
}) => {
  const { organization, customer, vehicle, site, pont1 } = await setup(context);
  const SAT = nextSaturday();
  const appt = await adminDb.appointment.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      bayId: pont1.id,
      type: "SERVICE",
      startsAt: zonedInstant(SAT, 9 * 60, TZ),
      endsAt: zonedInstant(SAT, 10 * 60 + 30, TZ),
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const noHorizontalScroll = async (target: Page) =>
    expect(await target.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );

  await page.goto("/rendez-vous");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="date"]').first().fill(SAT);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("list-view")).toBeVisible();
  await expect(
    page.locator(`[data-testid="appt-row"][data-appointment-id="${appt.id}"]`),
  ).toBeVisible();
  await noHorizontalScroll(page);
  await page.locator(`[data-testid="appt-row"][data-appointment-id="${appt.id}"]`).click();
  await expect(page.getByRole("dialog", { name: "Rendez-vous" })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "Fermer" }).click();
  // Jour par pont : défilement horizontal limité à la grille, jamais à la page.
  await page.getByRole("tab", { name: "Jour par pont" }).click();
  await expect(page.getByTestId("day-grid")).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto("/rendez-vous/aujourdhui");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("today-summary")).toBeVisible();
  await noHorizontalScroll(page);

  const booking = await issuePortalToken(adminDb, {
    organizationId: organization.id,
    scope: "BOOKING",
    // Lien du portail général (sans véhicule pré-identifié) : pas de contrôle « même jour ».
    targetId: customer.id,
    customerId: customer.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const portal = await customerContext.newPage();
  await portal.goto(`/p/${booking.token}/rdv`);
  await portal.waitForLoadState("networkidle");
  await expect(portal.getByTestId("portal-slot").first()).toBeVisible();
  await noHorizontalScroll(portal);
  await portal.getByTestId("portal-slot").first().click();
  await portal.getByRole("button", { name: "Réserver" }).click();
  await expect(portal.getByTestId("portal-done")).toContainText("C'est réservé");
  await customerContext.close();
});
