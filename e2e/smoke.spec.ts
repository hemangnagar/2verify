import { expect, test } from "@playwright/test";

/**
 * Login → dashboard, against the demo seed. Session two extends this with
 * "add a credential → see it on the dashboard" once the credential form exists.
 */
const email = process.env.SEED_ADMIN_EMAIL ?? "admin@sierra-rx.example.com";
const password = process.env.SEED_ADMIN_PASSWORD ?? "admin1234";

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("logs in and shows the demo dashboard story", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Tiles: 2 expiring ≤30, 5 expiring ≤90 (includes the 2), 1 overdue, 1 never verified.
  const tile = (label: string) => page.locator("[data-slot=card]", { hasText: label }).locator(".text-3xl");
  await expect(tile("Expiring ≤ 30 days")).toHaveText("2");
  await expect(tile("Expiring ≤ 90 days")).toHaveText("5");
  await expect(tile("Overdue")).toHaveText("1");
  await expect(tile("Never verified")).toHaveText("1");
  await expect(page.getByRole("row", { name: /Marcus Delgado/ })).toContainText("expired");
  await expect(page.getByRole("row", { name: /Elena Vasquez/ }).first()).toContainText("never");
});

test("rejects a bad password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});
