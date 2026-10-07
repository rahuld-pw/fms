// Phone-sized run through the public pages: QR report -> tracking page, and the vendor portal.
// Usage: node tests/ui/flows/public-flow.mjs <qr-token> <vendor-portal-token> <out-dir>
import { chromium } from "playwright";
const [qr, vtoken, OUT] = process.argv.slice(2);
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`${BASE}/q/${qr}`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/public1-qr.png`, fullPage: true });
await p.getByRole("button", { name: /Electrical|Plumbing|Furniture|Cleaning|Other/ }).first().click();
await p.getByLabel("Details").fill("Tube light flickering near the board");
await p.getByRole("button", { name: "Submit report" }).click();
await p.getByText(/reported as/).waitFor({ timeout: 20000 });
await p.screenshot({ path: `${OUT}/public2-done.png`, fullPage: true });
await p.getByRole("link", { name: "Track this issue" }).click();
await p.getByText("Updates").waitFor({ timeout: 20000 });
await p.screenshot({ path: `${OUT}/public3-status.png`, fullPage: true });
await p.goto(`${BASE}/vendor-portal?token=${vtoken}`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/public4-portal.png`, fullPage: true });
const order = p.getByRole("tab", { name: "Orders" });
await order.click();
await p.locator("button[aria-expanded]").first().click().catch(() => {});
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/public5-portal-orders.png`, fullPage: true });
await browser.close();
