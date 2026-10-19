import { test, expect } from "@playwright/test";

test("visiteur non connecté redirigé vers la connexion", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});
