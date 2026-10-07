// Drives receive goods -> assets -> invoice (3-way match) -> approve -> pay on a seeded PO.
// Usage: node tests/ui/flows/po-flow.mjs <po-id> <out-dir>   (SKIP_RECEIVE=1 to start at invoicing)
import { chromium } from "playwright";
const BASE = "http://localhost:3000", PO = process.argv[2], OUT = process.argv[3];
const browser = await chromium.launch();
async function login(email, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email); await page.fill("#password", "Password123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}
const toast = async (page) => (await page.locator("[data-sonner-toast]").last().textContent({ timeout: 15000 }).catch(() => "no toast"));
let p = await login("procurement@greenfield.test");
await p.goto(`${BASE}/po/orders/${PO}`, { waitUntil: "networkidle" });
if (!process.env.SKIP_RECEIVE) {
await p.getByRole("button", { name: "Receive goods" }).click();
await p.screenshot({ path: `${OUT}/flow1-receive.png` });
await p.getByRole("button", { name: "Post receipt" }).click();
console.log("receive:", await toast(p));
await p.getByRole("heading", { name: /Register \d+ asset/ }).waitFor({ timeout: 15000 });
await p.screenshot({ path: `${OUT}/flow2-assets.png` });
await p.getByRole("button", { name: "Create assets" }).click();
console.log("assets:", await toast(p));
}
await p.waitForTimeout(800);
await p.getByRole("button", { name: "More actions" }).click();
await p.getByRole("menuitem", { name: "Record invoice" }).click();
await p.getByLabel("Vendor invoice #").fill("LL/2026/0042");
await p.screenshot({ path: `${OUT}/flow3-invoice.png` });
await p.getByRole("button", { name: "Save invoice" }).click();
console.log("invoice:", await toast(p));
await p.waitForTimeout(800);
await p.getByRole("tab", { name: /Invoices/ }).click();
await p.screenshot({ path: `${OUT}/flow4-po-after.png`, fullPage: true });
const href = await p.locator('a[href^="/po/invoices/"]').first().getAttribute("href");
await p.context().close();
p = await login("finance@greenfield.test", { width: 390, height: 844 });
await p.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/flow5-invoice-phone.png`, fullPage: true });
await p.getByRole("button", { name: /Approve for payment|Override/ }).click();
await p.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
console.log("approve:", await toast(p));
await p.waitForTimeout(800);
await p.getByRole("button", { name: "Record payment" }).click();
await p.getByLabel(/Reference/).fill("UTR123456");
await p.getByRole("button", { name: "Save payment" }).click();
console.log("pay:", await toast(p));
await p.waitForTimeout(1000);
await p.screenshot({ path: `${OUT}/flow6-paid-phone.png`, fullPage: true });
await browser.close();
