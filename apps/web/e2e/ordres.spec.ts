import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M04 §12 — parcours principal : réception tablette (km 48 200, carburant 3/8, 4 photos,
// rayure aile AVG, objets, doléances, signature) → inspection (1 urgent) → travaux en attente
// d'accord, accord tracé → approbation directe → travaux terminés → contrôle qualité → prêt →
// restitution (client à 30 jours). Puis contrôle mobile 390 px sans défilement horizontal.
// Écart au fil rouge PRD : devis/portail (M05), encaissement et facture (M08) pas encore livrés.

/** PNG 64×48 uni généré à la volée (photo de réception factice). */
function pngFixture(): Buffer {
  const width = 64;
  const height = 48;
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
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = 40 + x;
      raw[o + 1] = 90;
      raw[o + 2] = 160 + y;
    }
  }
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

test("parcours OR : réception → inspection → accord → travaux → QC → restitution", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage OR ${randomBytes(3).toString("hex")}`,
      onboardingCompletedAt: new Date(),
    },
  });
  await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const user = await adminDb.user.create({
    data: {
      name: "E2E Chef d'atelier",
      email: `e2e-or-${randomBytes(4).toString("hex")}@example.com`,
    },
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
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "Kouassi Jean-Marc",
      phone: "+2250707070707",
      paymentTermsDays: 30,
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
  await adminDb.inspectionTemplate.create({
    data: {
      organizationId: organization.id,
      name: "Inspection 30 points",
      isDefault: true,
      items: [
        { category: "Freinage", label: "Plaquettes avant" },
        { category: "Freinage", label: "Disques avant" },
        { category: "Niveaux", label: "Huile moteur" },
      ],
    },
  });

  // ── Réception (6 étapes) ──
  await page.goto("/ordres/reception");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Plaque, téléphone ou nom du client").fill(`${plateSuffix} GH`);
  await page.getByRole("button", { name: /Kouassi Jean-Marc/ }).click();
  await expect(page.getByText("Véhicule choisi")).toBeVisible();
  await page.getByRole("button", { name: "Suivant →" }).click();

  await page.getByLabel("Kilométrage (km)").fill("48200");
  await page.getByRole("radio", { name: "3/8" }).click();
  await page.getByRole("button", { name: "Suivant →" }).click();

  const png = pngFixture();
  for (const slot of ["Avant", "Arrière", "Gauche", "Droite"]) {
    await page
      .locator(`input[type=file][aria-label="${slot}"]`)
      .setInputFiles({ name: `${slot}.png`, mimeType: "image/png", buffer: png });
  }
  await expect(page.getByRole("button", { name: "Reprendre" })).toHaveCount(4, { timeout: 20_000 });
  await expect(page.getByText("Envoi…")).toHaveCount(0, { timeout: 20_000 });
  const leftView = page.locator('svg[data-view="LEFT"]');
  await leftView.scrollIntoViewIfNeeded();
  const box = (await leftView.boundingBox())!;
  await leftView.click({ position: { x: box.width * 0.2, y: box.height * 0.4 } });
  await page.getByLabel("Zone").fill("Aile AVG");
  await page.getByRole("button", { name: "Ajouter le dommage" }).click();
  await expect(page.getByText("1. Aile AVG — rayure légère")).toBeVisible();
  await page.getByRole("button", { name: "Suivant →" }).click();

  await page.getByLabel("Roue de secours").check();
  await page
    .getByLabel("Objets personnels signalés")
    .fill("Sac noir dans le coffre — client informé");
  await page.getByRole("button", { name: "Suivant →" }).click();

  await page.getByLabel("Doléances du client").fill("Bruit au freinage à l'avant + vidange");
  await page.getByRole("button", { name: "Suivant →" }).click();

  await page.getByLabel("Nom du signataire").fill("Kouassi Jean-Marc");
  await page.getByTestId("signature-pad").scrollIntoViewIfNeeded();
  const pad = (await page.getByTestId("signature-pad").boundingBox())!;
  await page.mouse.move(pad.x + 20, pad.y + 30);
  await page.mouse.down();
  await page.mouse.move(pad.x + 120, pad.y + 90, { steps: 8 });
  await page.mouse.move(pad.x + 220, pad.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Valider la réception" }).click();

  await expect(page).toHaveURL(/\/ordres\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "OR-YOP-2026-00001" })).toBeVisible();
  const order = await adminDb.repairOrder.findFirstOrThrow({
    where: { organizationId: organization.id },
  });
  expect(order).toMatchObject({ status: "CHECKED_IN", mileageIn: 48_200, fuelLevel: 3 });
  expect(
    await adminDb.mileageReading.count({ where: { repairOrderId: order.id, source: "RECEPTION" } }),
  ).toBe(1);
  expect(
    await adminDb.attachment.count({ where: { entityId: order.id, kind: "photo_checkin" } }),
  ).toBe(4);

  // ── Inspection : 1 urgent, le reste OK ──
  await page.getByRole("link", { name: "Inspection", exact: true }).click();
  await page.getByRole("button", { name: "Démarrer l'inspection" }).click();
  const pads = page.getByRole("radiogroup", { name: "Plaquettes avant" });
  await pads.getByRole("radio", { name: /Urgent/ }).click();
  await expect(pads.getByRole("radio", { name: /Urgent/ })).toHaveAttribute("aria-checked", "true");
  for (const category of ["Freinage", "Niveaux"]) {
    await page
      .getByRole("region", { name: category })
      .getByRole("button", { name: /Tout OK/ })
      .click();
  }
  await expect(
    page.getByRole("radiogroup", { name: "Huile moteur" }).getByRole("radio", { name: /OK/ }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Terminer l'inspection" }).click();
  await expect(page.getByRole("heading", { name: "OR-YOP-2026-00001" })).toBeVisible();

  // ── Travaux : ligne au-delà du plafond (0) → accord tracé par téléphone → approbation ──
  await page.getByRole("button", { name: "Main-d'œuvre" }).first().click();
  await page.getByLabel("Désignation").fill("Remplacement plaquettes AV");
  await page.getByLabel("Heures").fill("1");
  await page.getByLabel("PU HT").fill("15000");
  await page.getByLabel("PU HT").blur();
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  await expect(page.getByText("En attente d'accord").first()).toBeVisible();
  await page.getByRole("button", { name: /Accord par téléphone/ }).click();
  await expect(page.getByTestId("order-total")).toHaveText("17 700 FCFA");
  await page.getByRole("button", { name: "Approuver les travaux" }).click();
  await expect(page.getByText(/OR-YOP-2026-00001 : Approuvé/)).toBeVisible();
  await page.getByRole("button", { name: /Terminer$/ }).click();
  await expect(page.getByRole("link", { name: "Contrôle qualité" })).toBeVisible();

  // ── Contrôle qualité → prêt ──
  await page.getByRole("link", { name: "Contrôle qualité" }).click();
  await expect(page.getByRole("radiogroup").first()).toBeVisible();
  for (const group of await page.getByRole("radiogroup").all()) {
    await group.getByRole("radio", { name: /OK/ }).first().click();
  }
  await page.getByRole("button", { name: /Valider \(véhicule prêt\)/ }).click();
  await expect(page.getByText("Prêt").first()).toBeVisible();

  // ── Restitution (client à 30 jours, sous plafond illimité) ──
  await page.getByRole("link", { name: "Restituer" }).click();
  await page.getByLabel("Objets et accessoires vérifiés avec le client").check();
  await page.getByLabel("Kilométrage de sortie").fill("48210");
  await page.getByRole("button", { name: "Restituer le véhicule" }).click();
  await expect(page.getByText("Restitué").first()).toBeVisible({ timeout: 15_000 });
  const delivered = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id } });
  expect(delivered.status).toBe("DELIVERED");
  expect(delivered.deliveredAt).not.toBeNull();
  const history = await adminDb.repairOrderStatusHistory.findMany({
    where: { repairOrderId: order.id },
    orderBy: { createdAt: "asc" },
  });
  expect(history.map((h) => h.toStatus)).toEqual([
    "CHECKED_IN",
    "DIAGNOSING",
    "APPROVED",
    "IN_PROGRESS",
    "QUALITY_CHECK",
    "READY",
    "DELIVERED",
  ]);

  // ── Mobile 390 px : pas de défilement horizontal ──
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/ordres", `/ordres/${order.id}`, "/ordres/reception"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noHorizontalScroll(page);
  }
  void vehicle;
});
