import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M06 §12 — parcours principal : le chef d'atelier affecte la vidange à Konan Yao → sur la
// tablette (390 px, contexte hors-ligne) Konan pointe son arrivée, démarre, met en pause,
// reprend, prend une photo, termine → retour en ligne, synchro → la carte passe en Contrôle
// qualité → le chef valide → l'OR est READY et le pointage apparaît dans /atelier/pointages
// avec l'origine « Hors-ligne (synchro) ». Aucune assertion ne dépend de l'heure réelle.

function pngFixture(): Buffer {
  const width = 32;
  const height = 24;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 120);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

async function signIn(context: BrowserContext, organizationId: string, membershipId: string) {
  const membership = await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: membership.userId,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
}

test("atelier : affectation → tablette hors-ligne → synchro → contrôle qualité → prêt", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Atelier ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const member = async (name: string, role: "MANAGER" | "MECHANIC") => {
    const user = await adminDb.user.create({
      data: { name, email: `e2e-m06-${randomBytes(4).toString("hex")}@example.com` },
    });
    return adminDb.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role,
        siteIds: [],
        skills: ["moteur"],
      },
    });
  };
  const manager = await member("Chef d'atelier E2E", "MANAGER");
  const konan = await member("Konan Yao", "MECHANIC");
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      phone: "+2250707070707",
    },
  });
  const plateSuffix = String(1000 + Math.floor(Math.random() * 8999));
  const vehicle = await adminDb.vehicle.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      plate: `${plateSuffix} GH 01`,
      plateCompact: `${plateSuffix}GH01`,
      make: "Toyota",
      model: "Corolla",
    },
  });
  const order = await adminDb.repairOrder.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      number: "OR-YOP-2026-00042",
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: "APPROVED",
      complaint: "Vidange à faire",
    },
  });
  await adminDb.repairOrderLine.create({
    data: {
      organizationId: organization.id,
      repairOrderId: order.id,
      type: "LABOR",
      description: "Vidange moteur + filtre",
      quantity: 1,
      unitPrice: 15_000,
      vatRate: 18,
      approval: "APPROVED",
    },
  });

  // ── 1. Le chef d'atelier affecte la vidange à Konan ──
  const office = await browser.newContext();
  await signIn(office, organization.id, manager.id);
  const desk = await office.newPage();
  desk.setDefaultTimeout(20_000);
  await desk.goto("/atelier/mecaniciens");
  const unassigned = desk.getByRole("region", { name: "Tâches à affecter" });
  await expect(unassigned.getByText("Vidange moteur + filtre")).toBeVisible();
  await unassigned.getByRole("button", { name: "Affecter" }).click();
  await desk
    .getByRole("dialog")
    .getByRole("button", { name: /Konan Yao/ })
    .click();
  await expect(desk.getByText("Tâche affectée à Konan Yao")).toBeVisible();

  // ── 2. Tablette de Konan, 390 px ──
  const tabletContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signIn(tabletContext, organization.id, konan.id);
  const tablet = await tabletContext.newPage();
  tablet.setDefaultTimeout(20_000);
  await tablet.goto("/tablette");
  await expect(tablet.getByRole("button", { name: "Mes tâches (1)" })).toBeVisible();
  await tablet.getByRole("button", { name: "Arrivée" }).click();
  await expect(tablet.getByText(/^Arrivé à/)).toBeVisible();
  await expect.poll(() => adminDb.attendance.count({ where: { membershipId: konan.id } })).toBe(1);
  await noHorizontalScroll(tablet);
  await tablet.getByRole("button", { name: "Mes tâches (1)" }).click();
  await expect(tablet).toHaveURL(/\/tablette\/taches$/);
  const card = tablet.getByTestId("task-Vidange moteur + filtre");
  await expect(card).toBeVisible();
  await noHorizontalScroll(tablet);

  // Réseau coupé : les actions partent dans la file locale.
  await tabletContext.setOffline(true);
  await expect(tablet.getByText(/^Hors-ligne —/)).toBeVisible();
  await card.getByRole("button", { name: "Démarrer" }).click();
  await expect(card.getByText("En cours")).toBeVisible();
  await card.getByRole("button", { name: "Pause" }).click();
  await card.getByRole("button", { name: "Pause déjeuner" }).click();
  await expect(card.getByText("En pause")).toBeVisible();
  await card.getByRole("button", { name: "Reprendre" }).click();
  await expect(card.getByText("En cours")).toBeVisible();
  await expect(tablet.getByTestId("pending-count")).toHaveText("3 action(s) à synchroniser");

  await card.getByRole("button", { name: "Détails" }).click();
  await expect(tablet).toHaveURL(/\/tablette\/taches\/[^/]+$/);
  await tablet
    .getByLabel("Prendre une photo")
    .setInputFiles({ name: "vidange.png", mimeType: "image/png", buffer: pngFixture() });
  await expect(tablet.getByText(/Photo enregistrée/)).toBeVisible();
  await noHorizontalScroll(tablet);
  const detail = tablet.getByTestId("task-Vidange moteur + filtre");
  await detail.getByRole("button", { name: "Terminer" }).click();
  await detail.getByLabel("Remarque (facultatif)").fill("Huile 5W30, filtre changé");
  await detail.getByRole("button", { name: "Terminer" }).click();
  await expect(detail.getByText("Terminée")).toBeVisible();
  // Rien n'est encore arrivé au serveur.
  expect(await adminDb.timeEntry.count({ where: { membershipId: konan.id } })).toBe(0);

  // Retour du réseau : synchronisation automatique.
  await tabletContext.setOffline(false);
  await expect
    .poll(
      async () => (await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id } })).status,
      {
        timeout: 30_000,
      },
    )
    .toBe("QUALITY_CHECK");
  await expect(tablet.getByTestId("pending-count")).toHaveCount(0);
  const entry = await adminDb.timeEntry.findFirstOrThrow({ where: { membershipId: konan.id } });
  expect(entry).toMatchObject({ source: "offline-sync", kind: "WORK" });
  expect(entry.endedAt).not.toBeNull();
  expect(
    await adminDb.attachment.count({
      where: { organizationId: organization.id, kind: "photo_work" },
    }),
  ).toBe(1);
  expect(await adminDb.workNote.count({ where: { repairOrderId: order.id } })).toBe(1);

  // ── 3. Kanban : la carte est en Contrôle qualité, le chef valide ──
  await desk.goto("/atelier");
  await expect(
    desk.getByTestId("column-quality_check").getByTestId("ro-card-OR-YOP-2026-00042"),
  ).toBeVisible();
  await desk.goto("/atelier/controle-qualite");
  await desk.getByRole("link", { name: "Faire le contrôle" }).click();
  await expect(desk).toHaveURL(/\/controle-qualite$/);
  const checklist = desk.getByRole("region", { name: "Points de contrôle" });
  const groups = checklist.getByRole("radiogroup");
  await expect(groups.first()).toBeVisible();
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).getByRole("radio", { name: "✓ OK", exact: true }).click();
  }
  await desk.getByRole("button", { name: /Valider \(véhicule prêt\)/ }).click();
  await expect
    .poll(
      async () => (await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id } })).status,
    )
    .toBe("READY");
  expect(
    await adminDb.qualityCheck.count({ where: { repairOrderId: order.id, result: "PASSED" } }),
  ).toBe(1);

  // ── 4. Le pointage apparaît dans /atelier/pointages, origine hors-ligne ──
  const entryDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Abidjan" }).format(
    entry.startedAt,
  );
  await desk.goto("/atelier/pointages");
  await desk.getByLabel("Jour").fill(entryDay);
  const row = desk.getByTestId("time-entry").filter({ hasText: "Konan Yao" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Hors-ligne (synchro)")).toBeVisible();

  // Kanban utilisable à 390 px (colonnes en onglets), sans défilement horizontal.
  await desk.setViewportSize({ width: 390, height: 844 });
  await desk.goto("/atelier");
  await expect(desk.getByRole("tab", { name: /Prêt \(1\)/ })).toBeVisible();
  await noHorizontalScroll(desk);

  await tabletContext.close();
  await office.close();
});
