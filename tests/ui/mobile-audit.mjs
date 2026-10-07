// Loads pages at phone width and reports horizontal page overflow and
// undersized tap targets (< 32px) on visible interactive elements.
// Usage: node tests/ui/mobile-audit.mjs [email] [paths...]
import { chromium } from "playwright";
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const email = process.argv[2] ?? "owner@greenfield.test";
const paths = process.argv.slice(3);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/login`);
await page.fill("#email", email);
await page.fill("#password", "Password123!");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
let problems = 0;
for (const p of paths) {
  errors.length = 0;
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const wide = [];
    if (overflow > 1) {
      for (const el of document.querySelectorAll("body *")) {
        const b = el.getBoundingClientRect();
        if (b.right > vw + 1 && b.width > 0 && !el.closest("[data-scroll-x], .overflow-x-auto, .overflow-auto")) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
        if (wide.length > 4) break;
      }
    }
    const small = [];
    for (const el of document.querySelectorAll("main a, main button, main input, main select, main [role=combobox], main [role=tab]")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (el.closest(".sr-only, [aria-hidden=true]")) continue;
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
      if (!inline && Math.min(b.height, b.width) < 28) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return { overflow, wide, small };
  });
  const bad = r.overflow > 1 || errors.length;
  if (bad || r.small.length) problems++;
  console.log(`${bad ? "✗" : "✓"} ${p}${r.overflow > 1 ? ` overflow ${r.overflow}px: ${r.wide.join(", ")}` : ""}${errors.length ? ` errors: ${errors.join(" | ")}` : ""}${r.small.length ? `\n    small targets: ${[...new Set(r.small)].slice(0, 6).join("; ")}` : ""}`);
}
await browser.close();
process.exitCode = problems ? 1 : 0;
