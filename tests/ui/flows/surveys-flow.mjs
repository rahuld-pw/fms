// Feedback & NPS end to end. Usage: node tests/ui/flows/surveys-flow.mjs <out-dir>
// Needs the seeded demo data (password Password123!).
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
async function login(email, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  return p;
}
const width = (p) => p.evaluate(() => document.documentElement.scrollWidth);

// 1. Owner: list, results, create
let p = await login("owner@greenfield.test");
await p.goto(`${BASE}/surveys`, { waitUntil: "networkidle" });
console.log("cards:", await p.locator("a[href^='/surveys/']").count());
await p.screenshot({ path: `${OUT}/s1-list.png`, fullPage: true });
await p.locator("a[href^='/surveys/']", { hasText: "Parent feedback" }).click();
await p.waitForURL(/\/surveys\/[0-9a-f-]{36}$/);
await p.waitForLoadState("networkidle");
console.log("results NPS stat:", (await p.locator("text=NPS").first().locator("xpath=..").textContent())?.slice(0, 60));
await p.getByRole("button", { name: "QR code" }).click();
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/s2-results.png`, fullPage: true });
await p.goto(`${BASE}/surveys`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "New survey" }).first().click();
const d = p.getByRole("dialog");
await d.getByLabel("Title").fill("Canteen feedback");
await d.getByRole("button", { name: /Satisfaction/ }).click();
await d.screenshot({ path: `${OUT}/s3-new-dialog.png` });
await d.getByRole("button", { name: "Create survey" }).click();
await p.waitForURL(/\/surveys\/[0-9a-f-]{36}$/, { timeout: 20000 });
console.log("created → results page:", await p.locator("h1").first().textContent());
await p.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
console.log("analytics has Feedback & NPS:", await p.getByRole("heading", { name: "Feedback & NPS" }).count());
await p.context().close();

// 2. Owner on a phone: results page fits
p = await login("owner@greenfield.test", { width: 360, height: 780 });
await p.goto(`${BASE}/surveys`, { waitUntil: "networkidle" });
await p.locator("a[href^='/surveys/']", { hasText: "Staff pulse" }).click();
await p.waitForURL(/\/surveys\/[0-9a-f-]{36}$/);
await p.waitForLoadState("networkidle");
console.log("phone results width:", await width(p));
await p.screenshot({ path: `${OUT}/s4-results-phone.png`, fullPage: true });
await p.context().close();

// 3. Parent answers the public link on a phone
const pub = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage();
pub.on("pageerror", (e) => errors.push(`public: ${e.message}`));
await pub.goto(`${BASE}/s/demo-parent-survey`, { waitUntil: "networkidle" });
console.log("public h1:", await pub.locator("h1").first().textContent(), "width:", await width(pub));
await pub.getByRole("radio", { name: "9" }).click();
await pub.locator("textarea").fill("Lovely annual day!");
await pub.locator("select:not([aria-label='Language'])").first().selectOption("parent");
await pub.screenshot({ path: `${OUT}/s5-public-phone.png`, fullPage: true });
await pub.getByRole("button", { name: "Send feedback" }).click();
console.log("public thank-you shown:", await pub.getByText("Thank you!").waitFor({ timeout: 15000 }).then(() => true, () => false));
await pub.context().close();

// 4. A staff member who hasn't answered sees the prompt on Home
p = await login("hod.science@greenfield.test", { width: 390, height: 844 });
const card = p.getByRole("radiogroup", { name: "Your score" });
await card.first().waitFor({ timeout: 15000 }).catch(() => {});
console.log("home prompt visible:", await card.count());
await p.screenshot({ path: `${OUT}/s6-home-prompt.png` });
if (await card.count()) {
  await p.getByRole("radio").nth(3).click();
  await p.getByRole("button", { name: "Submit" }).click();
  await p.waitForTimeout(1500);
  console.log("prompt gone after answer:", (await card.count()) === 0);
}
await p.context().close();

// 5. Resolution feedback
p = await login("facilities@greenfield.test");
await p.goto(`${BASE}/facility/feedback`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
console.log("resolution page h1:", await p.locator("h1").first().textContent());
await p.screenshot({ path: `${OUT}/s7-resolution.png`, fullPage: true });
await p.context().close();
p = await login("facilities@greenfield.test");
await p.goto(`${BASE}/analytics?`, { waitUntil: "networkidle" });
await p.locator("select[aria-label='Time range']").selectOption("365");
await p.waitForTimeout(1200);
console.log("resolver sees own rating:", await p.getByText("My resolution rating").count());
await p.context().close();
await browser.close();
console.log("page errors:", errors.length ? errors : "none");
