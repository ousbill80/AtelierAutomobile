import { randomBytes } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";

// M17 US-M17-10 — assistant lecture seule (fournisseur IA `console`, sans clé) : poser
// « combien me doit SOTRA ? » depuis /assistant et lire la réponse chiffrée avec ses liens.

const orgIds: string[] = [];
const userIds: string[] = [];

async function signIn(context: BrowserContext) {
  const organization = await adminDb.organization.create({
    data: {
      name: `E2E Assistant ${randomBytes(3).toString("hex")}`,
      plan: "PRO",
      onboardingCompletedAt: new Date(),
    },
  });
  orgIds.push(organization.id);
  const user = await adminDb.user.create({
    data: { name: "E2E Owner", email: `e2e-ai-${randomBytes(4).toString("hex")}@example.com` },
  });
  userIds.push(user.id);
  await adminDb.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER", siteIds: [] },
  });
  const site = await adminDb.site.create({
    data: { organizationId: organization.id, name: "Yopougon", code: "YOP" },
  });
  const customer = await adminDb.customer.create({
    data: {
      organizationId: organization.id,
      displayName: "SOTRA Logistique SARL",
      type: "COMPANY",
    },
  });
  await adminDb.invoice.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      customerId: customer.id,
      number: `FAC-E2E-${randomBytes(2).toString("hex").toUpperCase()}`,
      status: "OVERDUE",
      issuedAt: new Date(Date.now() - 40 * 86_400_000),
      dueDate: new Date(Date.now() - 30 * 86_400_000),
      total: 1_240_000,
      balance: 1_240_000,
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
}

test.afterAll(async () => {
  const where = { organizationId: { in: orgIds } };
  await adminDb.aiAssistantMessage.deleteMany({ where });
  await adminDb.aiAssistantThread.deleteMany({ where });
  await adminDb.aiInteraction.deleteMany({ where });
  await adminDb.invoice.deleteMany({ where });
  await adminDb.customer.deleteMany({ where });
  await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
  await adminDb.site.deleteMany({ where });
  await adminDb.auditLog.deleteMany({ where });
  await adminDb.notification.deleteMany({ where });
  await adminDb.membership.deleteMany({ where });
  await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
  await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
});

test("assistant : question sur un client, réponse chiffrée en lecture seule", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(context);
  await page.goto("/assistant");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("assistant-read-only")).toContainText(
    "Lecture seule — l'assistant ne modifie rien",
  );
  await page.getByLabel("Votre question…").fill("combien me doit SOTRA ?");
  await page.getByRole("button", { name: "Envoyer" }).click();
  const answer = page.getByTestId("assistant-answer").last();
  await expect(answer).toContainText("SOTRA Logistique SARL vous doit 1 240 000 FCFA", {
    timeout: 15_000,
  });
  await expect(answer.getByRole("link", { name: "SOTRA Logistique SARL" })).toBeVisible();
});
