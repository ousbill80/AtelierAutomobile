import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// Étape 6.4 (M13 partie 3) — parcours principal sur mobile 390 px : le gérant crée une clé API
// dans Paramètres > API et webhooks (clé montrée une seule fois) → un logiciel tiers crée un client
// avec Idempotency-Key puis le relit → le journal d'accès l'affiche → un webhook est créé (secret
// montré une fois) et testé avec le transport simulé (aucun réseau) → livraison « Livré ».

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

test("API publique : clé → création et lecture d'un client → webhook testé", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Garage API ${randomBytes(3).toString("hex")}`,
      // Offre PRO : API publique en écriture (M15 RG-M15-19).
      plan: "PRO",
      onboardingCompletedAt: new Date(),
    },
  });
  const user = await adminDb.user.create({
    data: { name: "E2E Gérant", email: `e2e-api-${randomBytes(4).toString("hex")}@example.com` },
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    { name: "atelieros_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);

  // 1. Clé API : nom, droits clients en lecture et écriture.
  await page.goto("/parametres/api");
  await expect(page.getByRole("heading", { name: "API et webhooks" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle clé" }).click();
  await page.getByLabel("Nom de la clé").fill("ERP comptable");
  await page.getByLabel("customers:write").check();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: "Créer la clé" }).click();
  const secret = page.getByTestId("once-secret").first();
  await expect(secret).toHaveText(/^ak_live_[0-9A-Za-z]{32}$/);
  const apiKey = (await secret.textContent())!.trim();
  await expect(page.getByTestId("api-key")).toHaveCount(1);
  await noHorizontalScroll(page);

  // 2. Logiciel tiers : création idempotente puis lecture du client.
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const body = {
    last_name: "Kouassi",
    first_name: "Jean-Marc",
    phone: "07 47 21 88 90",
    external_id: "CLI-0042",
  };
  const created = await page.request.post("/api/v1/customers", {
    headers: { ...headers, "idempotency-key": "erp-create-0042" },
    data: body,
  });
  expect(created.status()).toBe(201);
  const customer = await created.json();
  expect(customer).toMatchObject({
    display_name: "Kouassi Jean-Marc",
    phone: "+2250747218890",
    external_id: "CLI-0042",
  });
  const replay = await page.request.post("/api/v1/customers", {
    headers: { ...headers, "idempotency-key": "erp-create-0042" },
    data: body,
  });
  expect(replay.status()).toBe(201);
  expect((await replay.json()).id).toBe(customer.id);
  const list = await page.request.get("/api/v1/customers?limit=10", { headers });
  expect(list.status()).toBe(200);
  expect(list.headers()["x-ratelimit-limit"]).toBe("300");
  expect((await list.json()).data.map((c: { id: string }) => c.id)).toEqual([customer.id]);
  const forbidden = await page.request.get("/api/v1/invoices", { headers });
  expect(forbidden.status()).toBe(403);

  // 3. Journal d'accès de la clé.
  await page.reload();
  await page.getByRole("button", { name: "Journal d'accès" }).click();
  const logs = page.getByTestId("api-logs");
  await expect(logs).toContainText("/api/v1/customers");
  await expect(logs).toContainText("403");
  await noHorizontalScroll(page);

  // 4. Webhook : URL https publique, secret montré une fois, test via le transport simulé.
  await page.getByRole("button", { name: "Nouveau webhook" }).click();
  await page.getByLabel("URL de destination (https)").fill("https://hooks.example.com/atelieros");
  await page.getByLabel("customer.created").check();
  await page.getByRole("button", { name: "Créer le webhook" }).click();
  await expect(page.getByTestId("once-secret").last()).toHaveText(/^whsec_/);
  const webhook = page.getByTestId("webhook");
  await expect(webhook).toContainText("https://hooks.example.com/atelieros");
  await webhook.getByRole("button", { name: "Tester" }).click();
  await expect(webhook.getByRole("status")).toContainText("Livré (HTTP 200)");
  await expect(page.getByTestId("webhook-deliveries")).toContainText("webhook.test");
  await noHorizontalScroll(page);

  await context.close();
});
