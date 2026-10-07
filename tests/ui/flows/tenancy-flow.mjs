// Platform tenancy end to end: super admin creates an organisation (licensed
// for Facilities + Tasks) and invites its admin; the admin accepts; a public
// user gets a Tasks-only workspace and files a bug that the super admin sees.
// Usage: node tests/ui/flows/tenancy-flow.mjs <out-dir>
// Needs users root@platform.test (platform admin), principal@sunrise.test and asha@public.test (password Password123!).
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
async function login(email, viewport = { width: 1366, height: 860 }, next = "") {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await p.waitForLoadState("networkidle");
  return p;
}

// 1. super admin
let p = await login("root@platform.test");
console.log("root lands on:", new URL(p.url()).pathname);
await p.getByRole("button", { name: "New organisation" }).click();
const d = p.getByRole("dialog");
await d.getByLabel("Organisation name").fill("Sunrise Public School");
await d.getByLabel("First admin email").fill("principal@sunrise.test");
await d.getByLabel("First admin name").fill("Dr. Mehta");
await d.getByRole("button", { name: "Expenses" }).click(); // untick Expenses -> also unticks Purchasing
await p.screenshot({ path: `${OUT}/t1-create-org.png` });
await d.getByRole("button", { name: "Create and invite admin" }).click();
const link = await d.locator("input[readonly]").inputValue({ timeout: 15000 });
console.log("invite link:", link.replace(/invite\/.*/, "invite/<token>"));
await p.keyboard.press("Escape");
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/t2-orgs.png`, fullPage: true });
await p.context().close();

// 2. invited admin accepts
p = await login("principal@sunrise.test", undefined, new URL(link).pathname);
await p.waitForURL((u) => !u.pathname.startsWith("/invite"), { timeout: 30000, waitUntil: "commit" });
console.log("principal after accept:", new URL(p.url()).pathname);
const nav = await p.locator("aside nav a").allTextContents();
console.log("principal nav:", nav.join(" | "));
await p.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/t3-org-settings.png`, fullPage: true });
await p.context().close();

// 3. public user -> personal workspace, files a bug
p = await login("asha@public.test", { width: 390, height: 844 });
console.log("asha lands on:", new URL(p.url()).pathname);
await p.screenshot({ path: `${OUT}/t4-personal-phone.png` });
const r = await p.evaluate(async () => (await fetch("/api/v1/issues")).status);
console.log("asha GET /issues status:", r);
await p.getByRole("button", { name: "Account menu" }).click();
await p.getByRole("menuitem", { name: "Report a bug" }).click();
const fd = p.getByRole("dialog");
await fd.getByLabel("Summary").fill("Board view jumps when dragging on phone");
await fd.getByLabel("What went wrong?").fill("Open a project, switch to board, drag a card: the page scrolls instead.");
await p.screenshot({ path: `${OUT}/t5-feedback-phone.png` });
await fd.getByRole("button", { name: "Send" }).click();
await fd.getByText("Thanks").waitFor({ timeout: 10000 });
console.log("feedback sent");
await p.context().close();

// 4. super admin sees it
p = await login("root@platform.test");
await p.goto(`${BASE}/admin/feedback`, { waitUntil: "networkidle" });
console.log("feedback visible to admin:", await p.getByText("Board view jumps").isVisible());
await p.screenshot({ path: `${OUT}/t6-feedback-admin.png` });
await browser.close();
