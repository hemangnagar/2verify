import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

/**
 * End-to-end walkthrough against the demo seed (make demo) on a running app.
 * Operator console → switch into Sierra → dashboard → add credential → guided verify with
 * screenshot evidence (debits a credit) → screening match review → usage → exports → isolation.
 */
const OPERATOR = { email: process.env.SEED_OPERATOR_EMAIL ?? "ops@2verify.example.com", password: process.env.SEED_OPERATOR_PASSWORD ?? "operator1234" };
const ORG_ADMIN_PASSWORD = process.env.SEED_ORG_ADMIN_PASSWORD ?? "admin1234";
const SIERRA_ADMIN = { email: "admin@sierra.example.com", password: ORG_ADMIN_PASSWORD };
const HARBOR_ADMIN = { email: "admin@harbor.example.com", password: ORG_ADMIN_PASSWORD };

test.describe.configure({ mode: "serial" });

let sierraCredentialUrl = "";

async function login(page: Page, who: { email: string; password: string }, landsOn: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landsOn);
}

/** The card whose title is exactly `title` (card bodies mention other cards' words). */
function card(page: Page, title: string) {
  return page.locator("[data-slot=card]").filter({ has: page.locator("[data-slot=card-title]", { hasText: new RegExp(`^${title}$`) }) });
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
  await page.goto("/ops");
  await expect(page).toHaveURL(/\/login$/);
});

test("rejects a bad password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(SIERRA_ADMIN.email);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("operator console lists the three customers and switches into Sierra", async ({ page }) => {
  await login(page, OPERATOR, /\/ops$/);
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  for (const name of ["Sierra Specialty Pharmacy", "Harbor Compounding", "Prairie Infusion Partners"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const sierraRow = page.getByRole("row", { name: /Sierra Specialty Pharmacy/ });
  await expect(sierraRow).toContainText("Advanced");
  await expect(sierraRow).toContainText("1,812");
  await sierraRow.getByRole("button", { name: "Switch into org" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Operating as 2Verify inside Sierra Specialty Pharmacy/)).toBeVisible();
  await page.getByRole("button", { name: "Exit to console" }).click();
  await expect(page).toHaveURL(/\/ops$/);
});

test("org admin: dashboard shows the demo story", async ({ page }) => {
  await login(page, SIERRA_ADMIN, /\/$/);
  await expect(page.getByText(/Operating as 2Verify/)).toHaveCount(0);
  const tile = (label: string) => page.locator("[data-slot=card]", { hasText: label }).locator(".text-3xl");
  await expect(tile("Expiring ≤ 30 days")).toHaveText("2");
  await expect(tile("Expiring ≤ 90 days")).toHaveText("5");
  await expect(tile("Overdue")).toHaveText("1");
  await expect(tile("Never verified")).toHaveText("1");
  await page.goto("/?tab=overdue");
  await expect(page.getByRole("row", { name: /Marcus Delgado/ })).toContainText("expired");
  await page.goto("/?tab=neverVerified");
  await expect(page.getByRole("row", { name: /Elena Vasquez/ })).toContainText("never");
  await page.getByRole("row", { name: /Elena Vasquez/ }).getByRole("link", { name: "Elena Vasquez" }).click();
  await expect(page).toHaveURL(/\/credentials\/[^/]+$/);
  sierraCredentialUrl = page.url();
});

test("add a credential and see it on the list", async ({ page }) => {
  await login(page, SIERRA_ADMIN, /\/$/);
  await page.goto("/credentials/new");
  const aisha = await page.locator("select[name=personId] option", { hasText: "Rahman, Aisha" }).getAttribute("value");
  await page.locator("select[name=personId]").selectOption(aisha!);
  await page.locator("select[name=credentialTypeId]").selectOption({ label: "Pharmacy Technician License" });
  await page.locator("select[name=state]").selectOption("AZ");
  await page.locator("input[name=number]").fill("T-E2E-0001");
  await page.locator("input[name=expiresOn]").fill(new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page).toHaveURL(/\/credentials\/(?!new)[^/]+$/);
  await expect(page.getByRole("heading")).toContainText("AZ Pharmacy Technician License");
  await page.goto("/credentials?q=T-E2E-0001");
  await expect(page.getByRole("row", { name: /Aisha Rahman/ })).toContainText("never verified");
});

test("guided verification records evidence, updates the credential, and debits one credit", async ({ page }) => {
  await login(page, SIERRA_ADMIN, /\/$/);
  await page.goto("/usage");
  await expect(card(page, "Credits")).toContainText("1,812");
  await page.goto("/?tab=overdue");
  await page.getByRole("row", { name: /Marcus Delgado/ }).getByRole("link", { name: "Marcus Delgado" }).click();
  await page.getByRole("link", { name: "Verify now" }).click();
  await expect(page.getByRole("link", { name: /Open board lookup/ })).toHaveAttribute("href", /nvbop/);
  await page.locator("select[name=result]").selectOption("active");
  await page.locator("input[name=expirationSeen]").fill(new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("textarea[name=note]").fill("Board shows renewal processed on the new cycle.");
  await page.locator("input[name=evidence]").setInputFiles({ name: "board.png", mimeType: "image/png", buffer: fakeScreenshot() });
  await page.getByRole("button", { name: "Save verification" }).click();
  await expect(page).toHaveURL(/\/credentials\/[^/]+\?verified=1$/);
  await expect(page.getByRole("heading")).toContainText("active");
  const history = page.locator("[data-slot=card]", { hasText: "Verification history" });
  await expect(history).toContainText("board (manual)");
  await expect(history.locator("img[alt=evidence]")).toBeVisible();
  await expect(page.locator("[data-slot=card]", { hasText: "Alert history" })).toContainText("status change");
  await page.goto("/usage");
  await expect(card(page, "Credits")).toContainText("1,811");
  await expect(card(page, "Recent credit activity")).toContainText("verification");
});

test("screening match review and run-now", async ({ page }) => {
  await login(page, SIERRA_ADMIN, /\/$/);
  await page.goto("/screening/matches");
  const match = page.locator("[data-slot=card]", { hasText: "Robert Okafor" }).first();
  await expect(match).toContainText("pending");
  await match.locator("input[name=reviewNote]").fill("Different state (OH), no NPI, not our prescriber.");
  await match.getByRole("button", { name: "Dismiss as false positive" }).click();
  await expect(page.locator("[data-slot=card]", { hasText: "Robert Okafor" }).first()).toContainText("false positive");
  await page.goto("/screening");
  await page.getByRole("button", { name: "Run SAM now" }).click();
  await expect(page.getByText("SAM screening complete.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/usage");
  await expect(card(page, "Credits")).toContainText("1,811"); // screening is free
});

test("usage page for Harbor projects overage", async ({ page }) => {
  await login(page, HARBOR_ADMIN, /\/$/);
  await page.goto("/usage");
  await expect(page.getByText("Core plan")).toBeVisible();
  await expect(card(page, "Subscription")).toContainText("1 × $400");
  await expect(card(page, "Credits")).toContainText("39");
  await expect(card(page, "Projection")).toContainText("credits ·");
});

test("org isolation: Harbor cannot see a Sierra credential", async ({ page }) => {
  await login(page, HARBOR_ADMIN, /\/$/);
  expect(sierraCredentialUrl).toMatch(/credentials/);
  const res = await page.goto(sierraCredentialUrl);
  expect(res?.status()).toBe(404);
  await page.goto("/credentials?q=Delgado");
  await expect(page.getByRole("row", { name: /Marcus Delgado/ })).toHaveCount(0);
  const ops = await page.request.get("/ops");
  expect([401, 403, 404, 500].includes(ops.status()) || ops.url().includes("/login")).toBe(true);
});

test("exports respond", async ({ page }) => {
  await login(page, SIERRA_ADMIN, /\/$/);
  await page.goto("/entities");
  const href = await page.getByRole("link", { name: "Sierra Specialty Pharmacy", exact: true }).getAttribute("href");
  const entityId = href!.split("/").pop();
  const pdf = await page.request.get(`/api/reports/survey-pack?entity=${entityId}&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const zip = await page.request.get(`/api/reports/survey-pack?entity=${entityId}&format=zip`);
  expect(zip.status()).toBe(200);
  for (const kind of ["credentials", "screening", "training", "audit"]) {
    const res = await page.request.get(`/api/reports/csv?kind=${kind}`);
    expect(res.status(), kind).toBe(200);
  }
});
