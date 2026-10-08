// My tasks tabs (assigned / created by me / completed) and the Tasks overview.
// A teacher creates a task for a colleague, the colleague completes it, and
// the teacher still finds it under Completed. Usage: node tests/ui/flows/my-tasks-flow.mjs <out-dir>
import { chromium } from "playwright";
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
const call = (p, method, path, body) =>
  p.evaluate(async ([method, path, body]) => {
    const r = await fetch(`/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [method, path, body]);

// teacher creates a task for the HOD (not assigned to themselves)
let teacher = await login("teacher@greenfield.test");
const me = (await call(teacher, "GET", "/me")).json.data;
const hodId = (await call(teacher, "GET", "/members?limit=100")).json.data.find((m) => m.profile?.email === "hod.science@greenfield.test" || m.email === "hod.science@greenfield.test")?.user_id;
const created = await call(teacher, "POST", "/tasks", { title: "Collect lab safety forms", assignee_ids: hodId ? [hodId] : [], due_date: new Date().toISOString().slice(0, 10) });
console.log("create task:", created.status, "assigned to hod:", !!hodId);
const taskId = created.json.data.id;

await teacher.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
await teacher.getByRole("tab", { name: "Created by me" }).click();
await teacher.waitForLoadState("networkidle");
console.log("created tab shows it:", await teacher.getByRole("link", { name: "Collect lab safety forms" }).waitFor({ timeout: 15000 }).then(() => true, () => false));
await teacher.screenshot({ path: `${OUT}/created.png`, fullPage: true });

// HOD completes it
const hod = await login("hod.science@greenfield.test");
console.log("hod completes:", (await call(hod, "PATCH", `/tasks/${taskId}`, { status: "done" })).status);

// teacher: gone from "Created by me" (open only), present under Completed
await teacher.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
await teacher.getByRole("tab", { name: "Created by me" }).click();
await teacher.waitForLoadState("networkidle");
await teacher.waitForTimeout(1500);
console.log("still in created (open):", await teacher.getByRole("link", { name: "Collect lab safety forms" }).count());
await teacher.getByRole("tab", { name: "Completed" }).click();
await teacher.waitForLoadState("networkidle");
console.log("completed tab shows it:", await teacher.getByRole("link", { name: "Collect lab safety forms" }).waitFor({ timeout: 15000 }).then(() => true, () => false), "rows:", await teacher.getByRole("link", { name: "Collect lab safety forms" }).count());
await teacher.screenshot({ path: `${OUT}/completed.png`, fullPage: true });
// the creator can open the completed task
await teacher.getByRole("link", { name: "Collect lab safety forms" }).click();
await teacher.waitForLoadState("networkidle");
console.log("creator opens completed task:", (await teacher.locator("h1, [role=dialog] h2").first().textContent().catch(() => ""))?.slice(0, 60));

// overview, desktop and phone
for (const [who, vp] of [["owner@greenfield.test", { width: 1366, height: 900 }], ["teacher@greenfield.test", { width: 390, height: 844 }]]) {
  const p = await login(who, vp);
  await p.goto(`${BASE}/tasks/overview`, { waitUntil: "networkidle" });
  const stats = await p.locator("main").innerText();
  console.log(who, vp.width, "overview:", stats.split("\n").slice(0, 12).join(" | "));
  console.log("  overflow:", await p.evaluate(() => document.documentElement.scrollWidth));
  await p.screenshot({ path: `${OUT}/overview-${vp.width}.png`, fullPage: true });
}
console.log("errors:", JSON.stringify(errors));
await browser.close();
