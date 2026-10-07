import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { ApiError, unwrap } from "@/lib/api/errors";
import { createAdminClient, createUserClient, type DB } from "@/lib/supabase/server";
import { grantsAllow, permissionScopes, scopeAllows, type Grant, type Scope, type ScopeMode } from "./permissions";

export const ORG_COOKIE = "co_org";
export const MODULES = ["facility", "expense", "tasks", "po"] as const;
export type Module = (typeof MODULES)[number];

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  locale: string;
  fy_start_month: number;
  logo_path: string | null;
  settings: Record<string, unknown>;
  kind: "organisation" | "personal";
  licensed_modules: Module[];
}

/**
 * Everything the service layer needs to act on behalf of a caller. Created
 * once per request, either from the Supabase session cookie (end users; RLS
 * applies through `db`) or from an API key (service role + explicit checks).
 */
export class RequestContext {
  private grantsPromise?: Promise<Grant[]>;
  private modulesPromise?: Promise<Set<Module>>;
  private deptPromise?: Promise<Map<string, string | null>>;

  constructor(
    readonly kind: "user" | "api_key",
    readonly requestId: string,
    readonly userId: string,
    readonly org: OrgInfo,
    readonly db: DB,
    readonly apiKey?: { id: string; scopes: string[]; rateLimitPerMinute: number },
  ) {}

  get orgId() {
    return this.org.id;
  }

  /** Service-role client that records this caller as the actor (audit, in-DB checks). */
  admin(): DB {
    return createAdminClient({ userId: this.userId, apiKeyId: this.apiKey?.id ?? null });
  }

  grants(): Promise<Grant[]> {
    this.grantsPromise ??= (async () => {
      if (this.kind === "user") {
        return unwrap(await this.db.rpc("my_permissions", { p_org: this.orgId })) as Grant[];
      }
      return unwrap(
        await createAdminClient().rpc("user_permissions", { p_user: this.userId, p_org: this.orgId }),
      ) as Grant[];
    })();
    return this.grantsPromise;
  }

  /** Modules this caller can use: enabled by the org ∩ licensed ∩ the member's own module access. */
  modules(): Promise<Set<Module>> {
    this.modulesPromise ??= (async () => {
      const list =
        this.kind === "user"
          ? unwrap(await this.db.rpc("member_modules", { p_org: this.orgId }))
          : unwrap(await createAdminClient().rpc("member_modules", { p_org: this.orgId, p_user: this.userId }));
      return new Set((list ?? []) as Module[]);
    })();
    return this.modulesPromise;
  }

  private departments() {
    this.deptPromise ??= (async () => {
      const rows = unwrap(await this.admin().from("departments").select("id, campus_id").eq("org_id", this.orgId));
      return new Map(rows.map((r) => [r.id, r.campus_id]));
    })();
    return this.deptPromise;
  }

  async can(permission: string, scope: Scope = {}, mode: ScopeMode = "auto"): Promise<boolean> {
    if (this.apiKey && !scopeAllows(this.apiKey.scopes, permission)) return false;
    const [grants, depts] = await Promise.all([this.grants(), scope.departmentId ? this.departments() : null]);
    return grantsAllow(grants, permission, scope, mode, (id) => depts?.get(id));
  }

  async require(permission: string, scope: Scope = {}, mode: ScopeMode = "auto"): Promise<void> {
    if (!(await this.can(permission, scope, mode))) {
      throw new ApiError("forbidden", `Missing permission ${permission}`);
    }
  }

  /** Throws unless the module (or, for a list, any of them) is available to the caller. */
  async requireModule(module: Module | Module[]): Promise<void> {
    const wanted = Array.isArray(module) ? module : [module];
    const have = await this.modules();
    if (!wanted.some((m) => have.has(m))) {
      throw new ApiError("module_disabled", `The ${wanted.join(" / ")} module is not available to you in this organisation`);
    }
  }

  /** Where a permission is held: null = org-wide; else allowed campus/department ids. */
  async scopesFor(permission: string) {
    if (this.apiKey && !scopeAllows(this.apiKey.scopes, permission)) return { campusIds: [], departmentIds: [] };
    return permissionScopes(await this.grants(), permission);
  }
}

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

async function loadOrg(db: DB, orgId: string): Promise<OrgInfo | null> {
  const { data } = await db
    .from("organisations")
    .select("id, name, slug, timezone, currency, locale, fy_start_month, logo_path, settings, kind, licensed_modules")
    .eq("id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  return (data as OrgInfo | null) ?? null;
}

/** Org selection for signed-in users: explicit header > cookie > default org > first membership. */
async function resolveUserOrg(db: DB, userId: string, explicit?: string | null): Promise<OrgInfo | null> {
  const memberships = unwrap(
    await db.from("org_members").select("org_id").eq("user_id", userId).eq("status", "active"),
  ).map((m) => m.org_id);
  if (memberships.length === 0) return null;
  const cookieOrg = (await cookies()).get(ORG_COOKIE)?.value;
  const { data: profile } = await db.from("profiles").select("default_org_id").eq("id", userId).maybeSingle();
  const candidates = [explicit, cookieOrg, profile?.default_org_id, memberships[0]];
  // suspended organisations are invisible through RLS, so fall through to the next candidate
  for (const c of [...new Set([...candidates, ...memberships])]) {
    if (c && memberships.includes(c)) {
      const org = await loadOrg(db, c);
      if (org) return org;
    }
  }
  return null;
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user, or null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const db = await createUserClient();
  const { data } = await db.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});

/**
 * Context for server components / server actions / UI-originated API calls.
 * Returns null when not signed in or not a member of any organisation.
 */
export const getSessionContext = cache(async (explicitOrg?: string | null): Promise<RequestContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const db = await createUserClient();
  const org = await resolveUserOrg(db, user.id, explicitOrg);
  if (!org) return null;
  const requestId = (await headers()).get("x-request-id") ?? randomUUID();
  return new RequestContext("user", requestId, user.id, org, db);
});

/** Authenticates an API request: `Authorization: Bearer co_...` API key, else the session cookie. */
export async function getApiContext(req: Request, requestId: string): Promise<RequestContext> {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const key = auth.slice(7).trim();
    if (!key.startsWith("co_")) throw new ApiError("unauthorized", "Invalid API key");
    const admin = createAdminClient();
    const rows = unwrap(await admin.rpc("resolve_api_key", { p_key_hash: hashApiKey(key) }));
    const k = rows?.[0];
    if (!k) throw new ApiError("unauthorized", "Invalid, expired or revoked API key");
    const db = createAdminClient({ userId: k.created_by, apiKeyId: k.id });
    const org = await loadOrg(db, k.org_id);
    if (!org) throw new ApiError("unauthorized", "Organisation not found");
    return new RequestContext("api_key", requestId, k.created_by, org, db, {
      id: k.id,
      scopes: k.scopes,
      rateLimitPerMinute: k.rate_limit_per_minute,
    });
  }
  const user = await getSessionUser();
  if (!user) throw new ApiError("unauthorized", "Authentication required");
  const db = await createUserClient();
  const org = await resolveUserOrg(db, user.id, req.headers.get("x-org-id"));
  if (!org) throw new ApiError("forbidden", "You are not a member of this organisation");
  return new RequestContext("user", requestId, user.id, org, db);
}
