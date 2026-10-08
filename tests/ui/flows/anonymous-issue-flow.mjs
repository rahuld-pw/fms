// Anonymous issue reporting: a teacher reports anonymously (with a photo and
// a comment); the facilities manager sees "Anonymous" everywhere; the owner
// (organisation admin) sees who it was; the teacher sees "Anonymous (you)"
// and can still close it. Usage: node tests/ui/flows/anonymous-issue-flow.mjs <out-dir>
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.argv[2];
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
async function login(email, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "Password123!");
  await p.click("button[type=submit]");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return p;
}
const text = (p) => p.locator("main").innerText();

// 1. teacher reports anonymously, with a photo, on a phone
let p = await login("teacher@greenfield.test", { width: 390, height: 844 });
await p.goto(`${BASE}/facility/issues/new`, { waitUntil: "networkidle" });
const campus = p.getByRole("combobox").first();
// the campus the facilities manager looks after
if (await campus.isVisible().catch(() => false)) await campus.selectOption({ label: "Main Campus" }).catch(() => {});
await p.fill("#title", "Bullying near the staff room");
await p.fill("#desc", "Happens most afternoons after 3 pm.");
fs.writeFileSync(`${OUT}/photo.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
await p.locator("input[type=file]").setInputFiles(`${OUT}/photo.png`);
await p.getByRole("switch").click();
await p.screenshot({ path: `${OUT}/1-report.png`, fullPage: true });
await p.getByRole("button", { name: "Submit issue" }).click();
await p.waitForURL(/\/facility\/issues\/[0-9a-f-]{36}$/, { timeout: 30000 });
const issueUrl = p.url();
await p.waitForLoadState("networkidle");
await p.getByPlaceholder("Write a comment…").or(p.getByPlaceholder("Write a comment...")).fill("It happened again today.");
await p.getByRole("button", { name: "Comment", exact: true }).click();
await p.getByText("It happened again today.").first().waitFor({ timeout: 15000 });
await p.waitForTimeout(800);
const t1 = await text(p);
console.log("teacher sees:", t1.includes("Anonymous (you)") ? "Anonymous (you)" : "??", "| own name shown:", t1.includes("Arjun Mehta"));
await p.screenshot({ path: `${OUT}/2-teacher.png`, fullPage: true });

// 2. facilities manager: no name anywhere
p = await login("facilities@greenfield.test");
await p.goto(issueUrl, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const t2 = await text(p);
console.log("manager sees reporter:", t2.includes("Anonymous") ? "Anonymous" : "??", "| teacher's name anywhere:", t2.includes("Arjun Mehta"));
const api2 = await p.evaluate(async (id) => (await (await fetch(`/api/v1/issues/${id}`)).json()).data, issueUrl.split("/").pop());
console.log("manager API: reporter_id", api2.reporter_id, "created_by", api2.created_by, "confidential", JSON.stringify(api2.confidential_reporter));
await p.screenshot({ path: `${OUT}/3-manager.png`, fullPage: true });
await p.goto(`${BASE}/facility/issues`, { waitUntil: "networkidle" });
console.log("manager list shows name:", (await text(p)).includes("Arjun Mehta"));
const extra = await p.evaluate(async (id) => {
  const j = async (u) => (await (await fetch(u)).json()).data;
  return { comments: await j(`/api/v1/comments?entity_type=issue&entity_id=${id}`), files: await j(`/api/v1/attachments?entity_type=issue&entity_id=${id}`), activity: await j(`/api/v1/activity?entity_type=issue&entity_id=${id}`) };
}, issueUrl.split("/").pop());
const pick = (x) => (Array.isArray(x) ? x : x?.data ?? []);
console.log("manager comments:", JSON.stringify(pick(extra.comments).map((c) => ({ author: c.author?.full_name ?? null, label: c.author_label }))));
console.log("manager photos:", JSON.stringify(pick(extra.files).map((f) => ({ uploaded_by: f.uploaded_by ?? null }))));
console.log("manager activity actors:", JSON.stringify(pick(extra.activity).map((a) => a.actor?.full_name ?? a.actor_type)));

// 3. owner (organisation admin): sees who reported it
p = await login("owner@greenfield.test");
await p.goto(issueUrl, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const t3 = await text(p);
console.log("owner sees name:", t3.includes("Arjun Mehta"), "| admin-only label:", t3.includes("visible to admins only"));
await p.screenshot({ path: `${OUT}/4-owner.png`, fullPage: true });

// 4. the teacher can still act as the reporter (cancel while open)
p = await login("teacher@greenfield.test");
const r = await p.evaluate(async (id) => (await fetch(`/api/v1/issues/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) })).status, issueUrl.split("/").pop());
console.log("teacher cancels own anonymous issue:", r);
console.log("errors:", JSON.stringify(errors));
await browser.close();
