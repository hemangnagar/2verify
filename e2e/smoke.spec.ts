import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

/**
 * End-to-end smoke against the demo seed (make demo) on a running app.
 * Covers the walkthrough: login → dashboard → add credential → guided verify with screenshot
 * evidence → screening match review → exports.
 */
const email = process.env.SEED_ADMIN_EMAIL ?? "admin@sierra-rx.example.com";
const password = process.env.SEED_ADMIN_PASSWORD ?? "admin1234";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function fakeScreenshot(): Buffer {
  const png = new PNG({ width: 320, height: 200 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 240;
    png.data[i + 1] = 244;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("rejects a bad password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("dashboard shows the demo story", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const tile = (label: string) => page.locator("[data-slot=card]", { hasText: label }).locator(".text-3xl");
  await expect(tile("Expiring ≤ 30 days")).toHaveText("2");
  await expect(tile("Expiring ≤ 90 days")).toHaveText("5");
  await expect(tile("Overdue")).toHaveText("1");
  await expect(tile("Never verified")).toHaveText("1");
  await page.goto("/?tab=overdue");
  await expect(page.getByRole("row", { name: /Marcus Delgado/ })).toContainText("expired");
  await page.goto("/?tab=neverVerified");
  await expect(page.getByRole("row", { name: /Elena Vasquez/ })).toContainText("never");
});

test("add a credential and see it on the list", async ({ page }) => {
  await login(page);
  await page.goto("/credentials/new");
  const aisha = await page.locator("select[name=personId] option", { hasText: "Rahman, Aisha" }).getAttribute("value");
  await page.locator("select[name=personId]").selectOption(aisha!);
  await page.locator("select[name=credentialTypeId]").selectOption({ label: "Pharmacy Technician License" });
  await page.locator("select[name=state]").selectOption("AZ");
  await page.locator("input[name=number]").fill("T-E2E-0001");
  const expires = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  await page.locator("input[name=expiresOn]").fill(expires);
  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page).toHaveURL(/\/credentials\/[^/]+$/);
  await expect(page.getByRole("heading")).toContainText("AZ Pharmacy Technician License");
  await expect(page.getByText("No primary-source verification on record.")).toBeVisible();
  await page.goto("/credentials?q=T-E2E-0001");
  await expect(page.getByRole("row", { name: /Aisha Rahman/ })).toContainText("never verified");
});

test("guided verification records evidence and updates the credential", async ({ page }) => {
  await login(page);
  await page.goto("/?tab=overdue");
  await page.getByRole("row", { name: /Marcus Delgado/ }).getByRole("link", { name: "Marcus Delgado" }).click();
  await expect(page.getByRole("heading")).toContainText("NV Pharmacy Technician License");
  await expect(page.getByText("No primary-source verification on record.")).toBeVisible();
  await page.getByRole("link", { name: "Verify now" }).click();
  await expect(page.getByRole("heading", { name: /Verify: NV Pharmacy Technician License/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open board lookup/ })).toHaveAttribute("href", /nvbop/);
  await expect(page.getByText("Never verified. This will be the first evidence record.")).toBeVisible();

  const renewed = new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10);
  await page.locator("select[name=result]").selectOption("active");
  await page.locator("input[name=expirationSeen]").fill(renewed);
  await page.locator("textarea[name=note]").fill("Board shows renewal processed on the new cycle.");
  await page.locator("input[name=evidence]").setInputFiles({ name: "board.png", mimeType: "image/png", buffer: fakeScreenshot() });
  await page.getByRole("button", { name: "Save verification" }).click();

  await expect(page).toHaveURL(/\/credentials\/[^/]+\?verified=1$/);
  await expect(page.getByRole("heading")).toContainText("active");
  const history = page.locator("[data-slot=card]", { hasText: "Verification history" });
  await expect(history.getByRole("row")).toHaveCount(2); // header + 1
  await expect(history).toContainText("board (manual)");
  await expect(history).toContainText("Board shows renewal processed");
  await expect(history.locator("img[alt=evidence]")).toBeVisible();
  await expect(page.locator("[data-slot=card]", { hasText: "Alert history" })).toContainText("status change");
  await expect(page.locator("[data-slot=card]", { hasText: "Change log" })).toContainText("expiresOn");
});

test("screening match review and run-now", async ({ page }) => {
  await login(page);
  await page.goto("/screening/matches");
  const card = page.locator("[data-slot=card]", { hasText: "Robert Okafor" }).first();
  await expect(card).toContainText("pending");
  await card.locator("input[name=reviewNote]").fill("Different state (OH), no NPI, not our prescriber.");
  await card.getByRole("button", { name: "Dismiss as false positive" }).click();
  await expect(page.locator("[data-slot=card]", { hasText: "Robert Okafor" }).first()).toContainText("false positive");
  await expect(page.getByText("No pending matches.")).toBeVisible();

  await page.goto("/screening");
  await page.getByRole("button", { name: "Run SAM now" }).click();
  await expect(page.getByText("SAM screening complete.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /1 pending match to review/ })).toBeVisible();
});

test("exports respond", async ({ page }) => {
  await login(page);
  await page.goto("/entities");
  const href = await page.getByRole("link", { name: "Sierra Specialty Pharmacy", exact: true }).getAttribute("href");
  const entityId = href!.split("/").pop();
  const pdf = await page.request.get(`/api/reports/survey-pack?entity=${entityId}&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).length).toBeGreaterThan(20_000);
  const zip = await page.request.get(`/api/reports/survey-pack?entity=${entityId}&format=zip`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toContain("application/zip");
  for (const kind of ["credentials", "screening", "training", "audit"]) {
    const res = await page.request.get(`/api/reports/csv?kind=${kind}`);
    expect(res.status(), kind).toBe(200);
    expect((await res.text()).split("\n").length, kind).toBeGreaterThan(2);
  }
  await page.goto("/audit?table=Verification");
  await expect(page.getByRole("row").nth(1)).toContainText("Verification");
});
