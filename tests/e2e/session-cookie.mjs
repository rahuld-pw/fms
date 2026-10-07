// Prints a Cookie header for a seeded user by signing in through the UI (used by the smoke test).
import { chromium } from "playwright";
const [email = "owner@greenfield.test"] = process.argv.slice(2);
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", email);
await page.fill("#password", "Password123!");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
const cookies = await page.context().cookies();
console.log(cookies.map((c) => `${c.name}=${c.value}`).join("; "));
await browser.close();
