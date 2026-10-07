import { Pool, type PoolClient } from "pg";

export const DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/campus_ops_test";

export const pool = new Pool({ connectionString: DB_URL, max: 4 });

/**
 * A test session: everything runs inside one transaction that is rolled back
 * at the end, so tests are isolated. `as(user)` switches to the
 * `authenticated` role with that user's JWT claims (RLS applies); `asAdmin()`
 * switches back to the superuser (RLS bypassed) for fixtures and assertions.
 */
export class Session {
  constructor(public client: PoolClient) {}

  async as(userId: string | null, role: "authenticated" | "anon" | "service_role" = "authenticated") {
    await this.client.query("reset role");
    const claims = userId ? { sub: userId, role } : { role };
    await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await this.client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await this.client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    await this.client.query(`set local role ${role}`);
    return this;
  }

  async asAdmin() {
    await this.client.query("reset role");
    await this.client.query("select set_config('request.jwt.claims', '', true)");
    await this.client.query("select set_config('request.jwt.claim.sub', '', true)");
    await this.client.query("select set_config('request.jwt.claim.role', '', true)");
    return this;
  }

  async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params);
    return res.rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${sql}`);
    return rows[0];
  }

  async val<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const row = await this.one<Record<string, T>>(sql, params);
    return Object.values(row)[0];
  }

  /** Runs sql inside a savepoint and returns the error message (or null). */
  async error(sql: string, params: unknown[] = []): Promise<string | null> {
    await this.client.query("savepoint t");
    try {
      await this.client.query(sql, params);
      await this.client.query("release savepoint t");
      return null;
    } catch (e) {
      await this.client.query("rollback to savepoint t");
      return (e as Error).message;
    }
  }

  // ---- fixtures (run as admin) -------------------------------------------
  async user(email: string, name = email.split("@")[0]) {
    await this.asAdmin();
    return this.val<string>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id",
      [email, name],
    );
  }

  async org(ownerId: string, slug = `org-${Math.random().toString(36).slice(2, 8)}`) {
    await this.asAdmin();
    const orgId = await this.val<string>(
      "insert into organisations (name, slug) values ($1, $2) returning id",
      [`Org ${slug}`, slug],
    );
    await this.q("select app.bootstrap_org($1, $2)", [orgId, ownerId]);
    const campusA = await this.val<string>(
      "insert into campuses (org_id, name, code) values ($1, 'Campus A', 'A') returning id",
      [orgId],
    );
    const campusB = await this.val<string>(
      "insert into campuses (org_id, name, code) values ($1, 'Campus B', 'B') returning id",
      [orgId],
    );
    const deptA1 = await this.val<string>(
      "insert into departments (org_id, campus_id, name, code) values ($1, $2, 'Science', 'SCI') returning id",
      [orgId, campusA],
    );
    const deptA2 = await this.val<string>(
      "insert into departments (org_id, campus_id, name, code) values ($1, $2, 'Sports', 'SPO') returning id",
      [orgId, campusA],
    );
    const deptB1 = await this.val<string>(
      "insert into departments (org_id, campus_id, name, code) values ($1, $2, 'Science', 'SCI') returning id",
      [orgId, campusB],
    );
    return { orgId, campusA, campusB, deptA1, deptA2, deptB1 };
  }

  async member(
    orgId: string,
    userId: string,
    roleKey: string,
    scope: { campusId?: string; departmentId?: string } = {},
    extra: { managerId?: string; departmentId?: string } = {},
  ) {
    await this.asAdmin();
    await this.q(
      `insert into org_members (org_id, user_id, status, manager_id, department_id) values ($1, $2, 'active', $3, $4)
       on conflict (org_id, user_id) do update set manager_id = coalesce(excluded.manager_id, org_members.manager_id)`,
      [orgId, userId, extra.managerId ?? null, extra.departmentId ?? null],
    );
    const scopeType = scope.departmentId ? "department" : scope.campusId ? "campus" : "org";
    await this.q(
      `insert into user_role_assignments (org_id, user_id, role_id, scope_type, campus_id, department_id)
       select $1, $2, r.id, $4, $5, $6 from roles r where r.org_id = $1 and r.key = $3 on conflict do nothing`,
      [orgId, userId, roleKey, scopeType, scopeType === "campus" ? scope.campusId : null, scope.departmentId ?? null],
    );
  }
}

export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const s = new Session(client);
    return await fn(s);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
