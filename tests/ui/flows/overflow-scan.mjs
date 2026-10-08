// Mobile layout scan: every page at 360px; reports pages wider than the screen
// and the elements sticking out, then opens the page's main create dialog
// (if any) and checks it fits too.
// Usage: node tests/ui/flows/overflow-scan.mjs <out-dir>
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const W = 360;
const PAGES = {
  "owner@greenfield.test": [
    "/", "/analytics", "/approvals", "/notifications", "/scan",
    "/facility", "/facility/issues", "/facility/issues/new", "/facility/work-orders", "/facility/assets", "/facility/assets/audits",
    "/facility/assets/import", "/facility/locations", "/facility/maintenance", "/facility/vendors", "/facility/feedback",
    "/expense", "/expense/claims", "/expense/claims/new", "/expense/advances", "/expense/budgets", "/expense/petty-cash", "/expense/recurring",
    "/tasks", "/tasks/projects", "/tasks/teams",
    "/po", "/po/requisitions", "/po/requisitions/new", "/po/orders", "/po/orders/new", "/po/rfqs", "/po/invoices", "/po/items",
    "/surveys",
    "/settings", "/settings/users", "/settings/roles", "/settings/approvals", "/settings/configuration", "/settings/api-keys",
    "/settings/webhooks", "/settings/audit", "/settings/profile",
  ],
  "admin@platform.test": ["/admin", "/admin/analytics", "/admin/feedback", "/admin/admins"],
};
const PUBLIC = ["/login", "/signup", "/feedback", "/q/demo-room-101", "/vendor-portal", "/docs", "/s/demo-parent-survey"];

const browser = await chromium.launch();
const problems = [];

async function check(p, label) {
  return p.evaluate(({ label, W }) => {
    const out = [];
    const docW = document.documentElement.scrollWidth;
    if (docW > W + 1) out.push(`${label}: page ${docW}px wide`);
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" && el.closest("[role=dialog]") === null && r.right > W + 1) out.push(`${label}: fixed ${el.tagName.toLowerCase()} right=${Math.round(r.right)}`);
      if (r.right > W + 1 || r.left < -1) {
        // only report the outermost offenders inside a non-scrolling parent
        let scroller = el.parentElement, clipped = false;
        while (scroller) { const s = getComputedStyle(scroller); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; } scroller = scroller.parentElement; }
        if (!clipped) {
          const desc = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 4).join(".") : ""}`;
          out.push(`${label}: ${desc} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.textContent ?? "").trim().slice(0, 40)}"`);
        }
      }
    }
    return out.slice(0, 6);
  }, { label, W });
}

async function scan(p, path) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(600);
  problems.push(...(await check(p, path)));
  const shot = path.replaceAll("/", "_") || "_home";
  // main create action, if any
  const btn = p.locator("button:visible").filter({ hasText: /^\s*(New|Add|Create|Invite|Record|Upload|Top up|Request)\s+\S/ }).first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await p.waitForTimeout(500);
    const dlg = p.locator("[role=dialog]").first();
    if (await dlg.count()) {
      const box = await dlg.boundingBox();
      if (box && (box.x < -1 || box.x + box.width > W + 1)) problems.push(`${path}: dialog ${Math.round(box.x)}..${Math.round(box.x + box.width)}`);
      const inner = await dlg.evaluate((d, W) => [...d.querySelectorAll("*")].filter((e) => { if (e.closest("[aria-hidden=true]")) return false; const r = e.getBoundingClientRect(); return r.width && (r.right > W + 1 || r.left < -1); }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 30)}"`), W);
      if (inner.length) problems.push(`${path}: inside dialog → ${inner.join("; ")}`);
      await p.screenshot({ path: `${OUT}/${shot}-dialog.png` });
      await p.keyboard.press("Escape");
    }
  }
}

for (const [email, paths] of Object.entries(PAGES)) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 780 } });
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const path of paths) await scan(p, path);
  // first detail page of a few lists
  for (const [list, prefix] of [["/facility/issues", "/facility/issues/"], ["/po/orders", "/po/orders/"], ["/expense/claims", "/expense/claims/"], ["/facility/assets", "/facility/assets/"], ["/facility/vendors", "/facility/vendors/"], ["/surveys", "/surveys/"]]) {
    if (!paths.includes(list)) continue;
    await p.goto(`${BASE}${list}`, { waitUntil: "networkidle" });
    const href = await p.locator(`main a[href^='${prefix}']`).evaluateAll((as) => as.map((a) => a.getAttribute("href")).find((h) => /[0-9a-f-]{36}$/.test(h ?? "")) ?? null);
    if (href) await scan(p, href);
  }
  await ctx.close();
}
const ctx = await browser.newContext({ viewport: { width: W, height: 780 } });
const p = await ctx.newPage();
for (const path of PUBLIC) { await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {}); problems.push(...(await check(p, path))); }
await browser.close();
console.log(problems.length ? problems.join("\n") : "no overflow found");
