// Language picker (icon-only on phones) and translated module screens.
// Usage: node tests/ui/flows/i18n-screens-flow.mjs <out-dir>
// Needs the seeded demo users (password Password123!).
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];

async function session(viewport, lang) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "locale", value: lang, url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${lang} ${p.url()}: ${e.message}`));
  return p;
}
async function login(p, email) {
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
}

// 1. Phone sign-in page: icon-only picker that still switches language
let p = await session({ width: 390, height: 844 }, "en");
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const sel = p.locator("select[aria-label='Language']");
console.log("phone select opacity:", await sel.evaluate((el) => getComputedStyle(el).opacity), "box:", JSON.stringify(await sel.boundingBox()));
await p.screenshot({ path: `${OUT}/l1-login-phone-en.png` });
await sel.selectOption("ta");
await p.waitForFunction(() => document.documentElement.lang === "ta", null, { timeout: 30000 });
console.log("after phone switch h1:", await p.locator("h1").first().textContent());
await p.screenshot({ path: `${OUT}/l2-login-phone-ta.png` });
await login(p, "facilities@greenfield.test");
for (const path of ["/facility/issues", "/facility/work-orders", "/facility/assets"]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  console.log("ta phone", path, "h1:", await p.locator("h1").first().textContent(), "scrollWidth:", await p.evaluate(() => document.documentElement.scrollWidth));
  await p.screenshot({ path: `${OUT}/l3-ta${path.replaceAll("/", "_")}.png` });
}
await p.getByRole("button", { name: /.+/ }).filter({ has: p.locator("span.rounded-full, [data-avatar]") }).first().click().catch(() => {});
await p.context().close();

// 2. Desktop Hindi: module screens as the owner
p = await session({ width: 1366, height: 900 }, "hi");
await login(p, "owner@greenfield.test");
for (const path of ["/expense/claims", "/po/orders", "/tasks/projects", "/settings", "/settings/users", "/approvals"]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  console.log("hi", path, "h1:", await p.locator("h1").first().textContent());
  await p.screenshot({ path: `${OUT}/l4-hi${path.replaceAll("/", "_")}.png`, fullPage: true });
}
await p.context().close();
await browser.close();
console.log("page errors:", errors.length ? errors : "none");
