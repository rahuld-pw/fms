// Signs in as a seeded user and screenshots a list of pages (desktop + phone).
// Usage: node tests/ui/screens.mjs <out-dir> [email] [paths...]
import { chromium } from "playwright";
const out = process.argv[2] ?? "screens";
const email = process.argv[3] ?? "owner@greenfield.test";
const paths = process.argv.slice(4).length ? process.argv.slice(4) : ["/"];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const [name, viewport] of [["desktop", { width: 1366, height: 860 }], ["phone", { width: 390, height: 844 }]]) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  const ctx = await browser.newContext({ viewport, colorScheme: process.env.DARK ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && errors.push(`console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
    const file = `${out}/${name}${p.replace(/[/?=&]+/g, "_") || "_home"}.png`;
    await page.screenshot({ path: file, fullPage: name === "desktop" });
    console.log(file, errors.length ? `ERRORS: ${errors.join(" | ")}` : "");
    errors.length = 0;
  }
  await ctx.close();
}
await browser.close();
