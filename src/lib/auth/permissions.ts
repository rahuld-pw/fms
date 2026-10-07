/**
 * Pure permission evaluation mirroring app.has_permission() in SQL, so the
 * server helper and the UI agree with the RLS policies.
 *
 *   org-scoped grant         -> everything in the org
 *   campus-scoped grant      -> that campus and its departments
 *   department-scoped grant  -> that department only
 *
 * A target with neither campus nor department is org-level: in "strict" mode
 * only org-scoped grants satisfy it; in "auto" mode (default) any grant of the
 * permission does (org-wide resources such as vendors).
 */
export type ScopeType = "org" | "campus" | "department";

export interface Grant {
  permission_key: string;
  scope_type: ScopeType | string;
  campus_id: string | null;
  department_id: string | null;
}

export interface Scope {
  campusId?: string | null;
  departmentId?: string | null;
}

export type ScopeMode = "auto" | "strict" | "anywhere";

export function grantsAllow(
  grants: readonly Grant[],
  permission: string,
  scope: Scope = {},
  mode: ScopeMode = "auto",
  departmentCampus: (departmentId: string) => string | null | undefined = () => null,
): boolean {
  const relevant = grants.filter((g) => g.permission_key === permission);
  if (relevant.length === 0) return false;
  const campusId = scope.campusId ?? (scope.departmentId ? departmentCampus(scope.departmentId) ?? null : null);
  const departmentId = scope.departmentId ?? null;
  const orgLevel = !campusId && !departmentId;
  if (mode === "anywhere" || (mode === "auto" && orgLevel)) return true;
  return relevant.some(
    (g) =>
      g.scope_type === "org" ||
      (g.scope_type === "campus" && campusId != null && g.campus_id === campusId) ||
      (g.scope_type === "department" && departmentId != null && g.department_id === departmentId),
  );
}

/** Campus and department ids where a permission is held (null = whole org). */
export function permissionScopes(grants: readonly Grant[], permission: string) {
  const relevant = grants.filter((g) => g.permission_key === permission);
  if (relevant.some((g) => g.scope_type === "org")) return null;
  return {
    campusIds: relevant.filter((g) => g.scope_type === "campus").map((g) => g.campus_id!),
    departmentIds: relevant.filter((g) => g.scope_type === "department").map((g) => g.department_id!),
  };
}

/** API key scopes: exact permission, "resource:*" or "*". */
export function scopeAllows(scopes: readonly string[], permission: string): boolean {
  const [resource] = permission.split(":");
  return scopes.includes("*") || scopes.includes(permission) || scopes.includes(`${resource}:*`);
}
