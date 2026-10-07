// Calls every parameter-less GET endpoint from the OpenAPI spec, then the
// detail endpoint (/:id) of every list using the first row, and reports 5xx.
const BASE = process.env.API_BASE ?? "http://localhost:3000/api/v1";
const KEY = process.env.API_KEY;
const spec = await (await fetch(`${BASE}/openapi.json`)).json();
let failures = 0;
let count = 0;
const get = async (path) => {
  count++;
  const res = await fetch(`${BASE}${path}`, { headers: process.env.COOKIE ? { cookie: process.env.COOKIE } : { authorization: `Bearer ${KEY}` } });
  const ok = res.status < 500;
  const text = await res.text();
  if (!ok || process.env.VERBOSE) console.log(`${ok ? "  " : "✗ "}${res.status} GET ${path} ${ok ? "" : text.slice(0, 300)}`);
  if (!ok) failures++;
  try { return JSON.parse(text); } catch { return null; }
};
for (const [path, ops] of Object.entries(spec.paths)) {
  if (!ops.get || path.includes("{")) continue;
  if ((ops.get.parameters ?? []).some((p) => p.required && p.in === "query")) continue;
  const body = await get(path);
  const detail = `${path}/{id}`;
  const first = Array.isArray(body?.data) ? body.data[0] : null;
  if (first?.id && spec.paths[detail]?.get) await get(`${path}/${first.id}`);
}
console.log(`${count} requests, ${failures} failures`);
process.exit(failures ? 1 : 0);
