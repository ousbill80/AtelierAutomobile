import { test, expect } from "@playwright/test";

test("la page d'accueil affiche AtelierOS", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AtelierOS" })).toBeVisible();
});
