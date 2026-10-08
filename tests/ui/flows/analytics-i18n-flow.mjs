// Analytics per role and language switching.
// Usage: node tests/ui/flows/analytics-i18n-flow.mjs <out-dir>
// Needs the seeded demo users (password Password123!).
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();

async function login(email, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-IN" });
  // start in English on this device (an account may remember another language)
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", email, e.message));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const scopeLine = async (p) => (await p.locator("main").getByText(/Whole organisation|Campus:|Department:|Your own work/).first().textContent({ timeout: 20000 }).catch(() => "?"));

// 1. Owner: organisation-wide analytics
let p = await login("owner@greenfield.test");
await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
console.log("owner scope:", await scopeLine(p));
await p.locator("select[aria-label='Time range']").selectOption("365");
await p.waitForLoadState("networkidle");
await p.waitForTimeout(800);
await shot(p, "a1-owner-analytics");
// switch language to Hindi from the account menu
await p.getByRole("button", { name: "Account menu" }).click();
await p.locator("select[aria-label='Language']").selectOption("hi");
await p.waitForTimeout(2500);
await p.keyboard.press("Escape");
await p.waitForLoadState("networkidle");
console.log("after switch title:", await p.locator("h1").first().textContent());
await shot(p, "a2-owner-analytics-hi");
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
console.log("home h1 (hi):", await p.locator("h1").first().textContent());
await shot(p, "a3-home-hi");
await p.context().close();

// 2. Facility manager (campus) on a phone
p = await login("facilities@greenfield.test", { width: 390, height: 844 });
await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
console.log("fm scope:", await scopeLine(p));
console.log("fm scrollWidth:", await p.evaluate(() => document.documentElement.scrollWidth));
await shot(p, "a4-fm-analytics-phone");
await p.context().close();

// 3. Teacher (personal)
p = await login("teacher@greenfield.test");
await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
console.log("teacher scope:", await scopeLine(p));
console.log("teacher sees team table:", await p.getByText("Team workload").count());
await shot(p, "a5-teacher-analytics");
await p.context().close();

// 4. Platform admin
p = await login("admin@platform.test");
await p.goto(`${BASE}/admin/analytics`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
console.log("platform h1:", await p.locator("h1").first().textContent());
await shot(p, "a6-platform-analytics");
const r = await p.evaluate(async () => (await fetch("/api/v1/analytics")).status);
console.log("platform admin GET /analytics (no org):", r);
await p.context().close();
await browser.close();
