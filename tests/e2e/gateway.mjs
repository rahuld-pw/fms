// Minimal Supabase-compatible gateway for local/CI end-to-end tests without
// Docker: proxies /rest/v1 to PostgREST and emulates the small subset of the
// Auth and Storage APIs the app uses (password and email-code sign-in,
// getUser, signed URLs). Email codes are printed to the log and exposed at
// GET /__test/otp?email=... instead of being emailed.
// NOT for production.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const PGRST = process.env.PGRST_URL ?? "http://127.0.0.1:3001";
const SECRET = process.env.JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/campus_ops_test" });

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function sign(payload) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64(payload);
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = (token ?? "").split(".");
  if (!s) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (expect !== s) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const send = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

async function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
  return {
    access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `r-${user.id}`,
    user: { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: { provider: "email" }, user_metadata: user.raw_user_meta_data ?? {}, created_at: user.created_at },
  };
}

const otps = new Map(); // email -> { code, exp }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (url.pathname.startsWith("/rest/v1")) {
      const target = PGRST + url.pathname.replace("/rest/v1", "") + url.search;
      const headers = { ...req.headers };
      delete headers.host;
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const payload = ["GET", "HEAD"].includes(req.method) ? undefined : await body(req);
      const r = await fetch(target, { method: req.method, headers, body: payload });
      const out = Buffer.from(await r.arrayBuffer());
      const h = Object.fromEntries(r.headers);
      delete h["content-encoding"]; delete h["transfer-encoding"]; delete h["content-length"];
      delete h["access-control-allow-origin"];
      res.writeHead(r.status, h);
      return res.end(out);
    }
    if (url.pathname === "/auth/v1/token") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const grant = url.searchParams.get("grant_type");
      let user;
      if (grant === "password") {
        const { rows } = await pool.query(
          "select * from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)", [b.email, b.password]);
        user = rows[0];
        if (!user) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials" });
        await pool.query("update auth.users set last_sign_in_at = now() where id = $1", [user.id]);
      } else if (grant === "refresh_token") {
        const id = String(b.refresh_token ?? "").replace(/^r-/, "");
        user = (await pool.query("select * from auth.users where id::text = $1", [id])).rows[0];
        if (!user) return send(res, 400, { error: "invalid_grant" });
      }
      return send(res, 200, await session(user));
    }
    if (url.pathname === "/auth/v1/otp") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const email = String(b.email ?? "").toLowerCase();
      const { rows } = await pool.query("select id from auth.users where lower(email) = $1", [email]);
      // like Supabase with shouldCreateUser=false: unknown emails get an error
      if (!rows[0] && b.create_user === false) return send(res, 422, { code: "otp_disabled", msg: "Signups not allowed for otp" });
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      otps.set(email, { code, exp: Date.now() + 600_000 });
      console.log(`[otp] ${email}: ${code}`);
      return send(res, 200, {});
    }
    if (url.pathname === "/auth/v1/verify") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const email = String(b.email ?? "").toLowerCase();
      const entry = otps.get(email);
      if (!entry || entry.exp < Date.now() || entry.code !== String(b.token)) return send(res, 403, { code: "otp_expired", msg: "Token has expired or is invalid" });
      otps.delete(email);
      const user = (await pool.query("select * from auth.users where lower(email) = $1", [email])).rows[0];
      return send(res, 200, await session(user));
    }
    if (url.pathname === "/__test/otp") return send(res, 200, { code: otps.get(String(url.searchParams.get("email")).toLowerCase())?.code ?? null });
    if (url.pathname === "/auth/v1/user") {
      const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!claims?.sub) return send(res, 401, { code: 401, msg: "invalid JWT" });
      if (req.method === "PUT") {
        const b = JSON.parse((await body(req)).toString() || "{}");
        if (b.data) await pool.query("update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || $2 where id = $1", [claims.sub, b.data]);
      }
      const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
      if (!rows[0]) return send(res, 404, { msg: "user not found" });
      return send(res, 200, (await session(rows[0])).user);
    }
    if (url.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
      const path = url.pathname.replace("/storage/v1/object/upload/sign/", "");
      if (req.method === "POST") return send(res, 200, { url: `/object/upload/sign/${path}?token=t-${Date.now()}` });
      await body(req);
      return send(res, 200, { Key: path });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      const path = url.pathname.replace("/storage/v1/object/sign/", "");
      return send(res, 200, { signedURL: `/object/sign/${path}?token=t-${Date.now()}` });
    }
    send(res, 404, { message: `gateway: no route for ${req.method} ${url.pathname}` });
  } catch (e) {
    send(res, 500, { message: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`gateway on :${PORT}`);
  console.log(`ANON_KEY=${sign({ role: "anon", iss: "supabase-demo", exp: 1983812996 })}`);
  console.log(`SERVICE_ROLE_KEY=${sign({ role: "service_role", iss: "supabase-demo", exp: 1983812996 })}`);
});
