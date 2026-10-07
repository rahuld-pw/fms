import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { unwrap } from "@/lib/api/errors";
import type { SessionData } from "@/components/app/session";
import { createUserClient } from "@/lib/supabase/server";
import { getSessionContext, getSessionUser } from "./context";

export async function isPlatformAdmin() {
  const db = await createUserClient();
  const { data } = await db.rpc("am_platform_admin");
  return data === true;
}
import { getMe } from "@/lib/services/core";

/**
 * Loads everything the app shell needs for the signed-in user. Redirects to
 * /login when signed out; a user without an organisation goes to the platform
 * console (platform admins) or to /onboarding (personal workspace).
 */
export const requireSession = cache(async () => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getSessionContext();
  if (!ctx) redirect((await isPlatformAdmin()) ? "/admin" : "/onboarding");
  const [me, campuses, departments, platformAdmin] = await Promise.all([
    getMe(ctx),
    ctx.db.from("campuses").select("id, name, code").eq("org_id", ctx.orgId).is("deleted_at", null).order("name"),
    ctx.db.from("departments").select("id, name, code, campus_id").eq("org_id", ctx.orgId).is("deleted_at", null).order("name"),
    isPlatformAdmin(),
  ]);
  const data: SessionData = {
    user: { id: ctx.userId, email: me.user.email, full_name: me.user.full_name, avatar_path: me.user.avatar_path },
    org: ctx.org,
    orgs: me.orgs as SessionData["orgs"],
    modules: me.modules,
    permissions: me.permissions,
    campuses: unwrap(campuses),
    departments: unwrap(departments),
    isPlatformAdmin: platformAdmin,
  };
  return { ctx, data };
});
