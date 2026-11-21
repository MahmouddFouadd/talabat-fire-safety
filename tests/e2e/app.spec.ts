import { test, expect, type Page } from "@playwright/test";
import { login, mockSupabase } from "./mock";

async function noHorizontalOverflow(page: Page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, "page must not scroll sideways").toBeLessThanOrEqual(cw + 1);
}

test("admin dashboard shows figures from the database", async ({ page }, info) => {
  await login(page, "admin");
  await expect(page.getByRole("heading", { level: 1, name: "لوحة المتابعة" })).toBeVisible();
  await expect(page.getByText("من 66").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-admin-dashboard.png`, fullPage: false });
});

test("admin pages render without overflow", async ({ page }, info) => {
  await login(page, "admin");
  for (const [hash, name] of [["#/admin/stores", "stores"], ["#/admin/issues", "issues"], ["#/admin/equipment", "equipment"], ["#/admin/inspections", "inspections"], ["#/admin/staff", "staff"], ["#/admin/settings", "settings"]]) {
    await page.goto(`./${hash}`);
    await expect(page.locator("main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/shots/${info.project.name}-admin-${name}.png` });
  }
});

test("language switch flips direction and keeps the page", async ({ page }) => {
  await login(page, "admin");
  await page.goto("./#/admin/stores");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "EN" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("main h1")).toContainText("Stores");
  await expect(page).toHaveURL(/#\/admin\/stores/);
});

test("technician sees only own stores and can complete an inspection", async ({ page }, info) => {
  await login(page, "tech");
  await expect(page.locator("main h1")).toContainText("(13)");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-tech-stores.png` });
  await page.getByRole("button", { name: /ابدأ الفحص|كمّل المسودة/ }).first().click();
  await expect(page.getByText("المجموع مظبوط")).toBeVisible();
  // break the tally → cannot advance
  await page.locator(".counter").first().getByRole("button", { name: "−" }).click();
  await expect(page.locator(".tally.bad")).toBeVisible();
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  // mark one as damaged → valid again
  await page.locator(".counter").nth(1).getByRole("button", { name: "+" }).click();
  await expect(page.locator(".tally.ok")).toBeVisible();
  await page.screenshot({ path: `test-results/shots/${info.project.name}-tech-step1.png` });
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.getByText("أعطال هتتفتح تلقائياً")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "إرسال الفحص" }).click();
  await expect(page.getByText("INS-TEST-0001")).toBeVisible();
});

test("technician can sign in with mobile/username + PIN", async ({ page }) => {
  await mockSupabase(page, "tech");
  await page.goto("./");
  await page.getByRole("tab", { name: "PIN" }).click();
  await page.getByLabel(/اسم المستخدم/).fill("01012345678");
  await page.getByLabel(/PIN/).fill("1111");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel(/PIN/).fill("2580");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.locator("main h1")).toContainText("(13)");
  await expect(page.getByText("فعّل الدخول السريع بـ PIN")).toBeVisible();
});

for (const mode of ["password", "pin"]) test(`sign-in screen fits the screen width (${mode})`, async ({ page }) => {
  await page.addInitScript((m) => localStorage.setItem("fs-login-mode", m), mode);
  await mockSupabase(page, "tech");
  await page.goto("./");
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => {
    const card = document.querySelector(".login .box")!.getBoundingClientRect();
    const outOfScreen = [...document.querySelectorAll(".login *")].some((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); });
    const outOfCard = [...document.querySelectorAll(".login .box *")].some((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > card.right + 1 || b.left < card.left - 1); });
    return outOfScreen || outOfCard;
  });
  expect(overflow, "no sign-in element may stick out of the screen").toBe(false);
});
