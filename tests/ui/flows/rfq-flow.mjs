// Drives approve requisition -> RFQ -> two quotes -> comparison -> award.
// Usage: node tests/ui/flows/rfq-flow.mjs <requisition-id> <out-dir>   (RFQ=<id> to start from an existing RFQ)
import { chromium } from "playwright";
const BASE = "http://localhost:3000", REQ = process.argv[2], OUT = process.argv[3];
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
let p = await login(process.env.APPROVER ?? "owner@greenfield.test");
await p.goto(`${BASE}/po/requisitions/${REQ}`, { waitUntil: "networkidle" });
const approve = p.getByRole("button", { name: /^Approve/ }).first();
if (await approve.isVisible().catch(() => false)) {
  await approve.click();
  const dlg = p.getByRole("dialog");
  if (await dlg.isVisible().catch(() => false)) await dlg.getByRole("button", { name: /Approve/ }).click();
  console.log("approve:", await toast(p));
} else console.log("no approve button");
await p.context().close();
p = await login("procurement@greenfield.test");
await p.goto(`${BASE}/po/requisitions/${REQ}`, { waitUntil: "networkidle" });
const RFQ = process.env.RFQ;
if (RFQ) { await p.goto(`${BASE}/po/rfqs/${RFQ}`, { waitUntil: "networkidle" }); } else {
await p.getByRole("button", { name: "Request quotes" }).click();
const dlg = p.getByRole("dialog");
await dlg.getByRole("combobox").first().click();
const opts = p.getByRole("option");
await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/rfq0-open.png` }); await opts.first().waitFor();
const n = await opts.count();
await opts.nth(0).click();
if (n > 1) { await opts.nth(1).click().catch(() => {}); }
await p.keyboard.press("Escape").catch(() => {});
await p.screenshot({ path: `${OUT}/rfq1-dialog.png` });
await dlg.getByRole("button", { name: "Send RFQ" }).click();
console.log("rfq:", await toast(p));
await p.waitForURL(/\/po\/rfqs\//);
}
for (const [i, rate] of [[0, "0.9"], [1, "1.05"]]) {
  await p.getByRole("button", { name: "Record quote" }).click();
  const q = p.getByRole("dialog");
  const sel = q.getByLabel("Vendor");
  const values = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  if (!values[i]) { await p.keyboard.press("Escape"); break; }
  await sel.selectOption(values[i]);
  const inputs = q.locator('input[type=number][step="0.01"]');
  for (let k = 0; k < await inputs.count(); k++) await inputs.nth(k).fill(String(Math.round((1000 + k * 250) * Number(rate))));
  await q.getByRole("button", { name: "Save quote" }).click();
  console.log("quote:", await toast(p));
  await p.waitForTimeout(800);
}
await p.screenshot({ path: `${OUT}/rfq2-comparison.png`, fullPage: true });
await p.getByRole("button", { name: "Award" }).first().click();
await p.getByRole("dialog").getByRole("button", { name: /Award and create PO/ }).click();
console.log("award:", await toast(p));
await p.waitForURL(/\/po\/orders\//);
await p.waitForLoadState("networkidle");
await p.screenshot({ path: `${OUT}/rfq3-po.png`, fullPage: true });
await browser.close();
