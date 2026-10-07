// Phone-sized check of both sign-in methods on /login.
// Usage: node tests/ui/flows/login-flow.mjs <out-dir>
import { chromium } from "playwright";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/login-password.png` });
await p.getByRole("tab", { name: "Email code" }).click();
await p.fill("#email", "owner@greenfield.test");
await p.screenshot({ path: `${OUT}/login-otp.png` });
await p.getByRole("button", { name: "Email me a code" }).click();
await p.waitForTimeout(1500);
console.log("code field shown:", await p.locator("#code").isVisible());
console.log("toast:", await p.locator("[data-sonner-toast]").last().textContent().catch(() => "none"));
await p.screenshot({ path: `${OUT}/login-otp-code.png` });
const GATEWAY = process.env.GATEWAY_URL ?? "http://127.0.0.1:54321";
const { code } = await (await fetch(`${GATEWAY}/__test/otp?email=owner@greenfield.test`)).json();
await p.fill("#code", "000000");
await p.getByRole("button", { name: "Verify and sign in" }).click();
await p.waitForTimeout(1200);
console.log("wrong code stays on login:", new URL(p.url()).pathname === "/login");
await p.fill("#code", code);
await p.getByRole("button", { name: "Verify and sign in" }).click();
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
console.log("signed in with code, now at:", new URL(p.url()).pathname);
await browser.close();
