// PWA + push end to end against a production build (npm run build && npm start).
// Checks: service worker registers, offline page shows when the network is gone,
// the device push toggle works, and a push reaches the device's push service
// (a local stand-in at :9911 records the encrypted delivery).
// Usage: node tests/ui/flows/pwa-push-flow.mjs <out-dir>
import { chromium } from "playwright";
import https from "node:https";
import fs from "node:fs";
import crypto from "node:crypto";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const errors = [];

// stand-in push service
const deliveries = [];
// HTTPS like real push services: start the app with NODE_EXTRA_CA_CERTS=<cert> and
// PUSH_ALLOW_LOCAL_ENDPOINTS=1, and pass TLS_DIR (cert.pem + key.pem for 127.0.0.1)
const tls = { cert: fs.readFileSync(`${process.env.TLS_DIR}/cert.pem`), key: fs.readFileSync(`${process.env.TLS_DIR}/key.pem`) };
const sink = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    deliveries.push({ path: req.url, encoding: req.headers["content-encoding"], auth: String(req.headers.authorization ?? "").slice(0, 6), bytes: Buffer.concat(chunks).length });
    res.writeHead(req.url.includes("gone") ? 410 : 201).end();
  });
}).listen(9911);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(["notifications"], { origin: BASE });
await ctx.addInitScript(() => {
  if (!("Notification" in window)) return;
  Object.defineProperty(Notification, "permission", { get: () => "granted" });
  Notification.requestPermission = async () => "granted";
});
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`${BASE}/login`);
await p.fill("#email", "owner@greenfield.test");
await p.fill("#password", "Password123!");
await p.click("button[type=submit]");
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await p.waitForLoadState("networkidle");
console.log("after sign-in:", new URL(p.url()).pathname);

const sw = await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: !!reg.active };
});
console.log("service worker:", JSON.stringify(sw));
console.log("manifest link:", await p.locator('link[rel="manifest"]').getAttribute("href"));

// offline: with the server unreachable, a page load shows the offline page
// (Playwright's setOffline doesn't reach service workers, so the server is stopped:
// pass NEXT_PID and the command that restarts it in RESTART_CMD)
if (process.env.NEXT_PID) {
  const { execSync } = await import("node:child_process");
  process.kill(Number(process.env.NEXT_PID));
  await new Promise((r) => setTimeout(r, 1500));
  await p.goto(`${BASE}/tasks`).catch(() => {});
  console.log("offline page:", await p.locator("h1").first().textContent());
  await p.screenshot({ path: `${OUT}/pwa-offline.png` });
  execSync(process.env.RESTART_CMD, { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${BASE}/login`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// device push toggle in profile settings
await p.goto(`${BASE}/settings/profile`, { waitUntil: "networkidle" });
const toggle = p.getByRole("switch", { name: "Notifications on this device" });
await toggle.scrollIntoViewIfNeeded();
await p.screenshot({ path: `${OUT}/push-toggle.png` });
await toggle.click();
const toast = await p.locator("[data-sonner-toast]").last().textContent({ timeout: 15000 }).catch(() => "no toast");
console.log("toggle toast:", toast);
const browserSub = await p.evaluate(async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()));
console.log("browser subscription:", browserSub);

// a subscription whose push service is the local stand-in, plus one that is gone
const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
for (const path of ["/push/device-1", "/push/gone"]) {
  const r = await p.evaluate(async ([body]) => (await fetch("/api/v1/me/push-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, [{ endpoint: `https://127.0.0.1:9911${path}`, keys }]);
  console.log("subscribe", path, r);
}
const test = await p.evaluate(async () => (await fetch("/api/v1/me/push-test", { method: "POST" })).json());
console.log("push test:", JSON.stringify(test.data ?? test.error));
console.log("deliveries:", JSON.stringify(deliveries));
const left = await p.evaluate(async () => (await fetch("/api/v1/me/push-subscriptions/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: "https://127.0.0.1:9911/push/device-1" }) })).status);
console.log("turn off device-1:", left);
// a non push-service address is refused
const bad = await p.evaluate(async ([body]) => (await fetch("/api/v1/me/push-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, [{ endpoint: "https://example.com/hook", keys }]);
console.log("subscribe example.com:", bad);
console.log("errors:", JSON.stringify(errors));
await browser.close();
sink.close();
