import { describe, expect, it } from "vitest";
import { grantsAllow, permissionScopes, scopeAllows, type Grant } from "@/lib/auth/permissions";

const CAMPUS_A = "a0000000-0000-4000-8000-000000000001";
const CAMPUS_B = "b0000000-0000-4000-8000-000000000002";
const DEPT_SCI = "d0000000-0000-4000-8000-000000000003";
const DEPT_ART = "d0000000-0000-4000-8000-000000000004";
const deptCampus = (d: string) => ({ [DEPT_SCI]: CAMPUS_A, [DEPT_ART]: CAMPUS_A })[d];
const g = (permission_key: string, scope_type: Grant["scope_type"], campus_id: string | null = null, department_id: string | null = null): Grant => ({ permission_key, scope_type, campus_id, department_id });

describe("grantsAllow (mirrors app.has_permission)", () => {
  it("denies when the permission is not granted at all", () => {
    expect(grantsAllow([g("issue:read", "org")], "issue:update")).toBe(false);
  });

  it("org-scoped grants cover every campus and department", () => {
    const grants = [g("po:approve", "org")];
    expect(grantsAllow(grants, "po:approve", { campusId: CAMPUS_B }, "strict")).toBe(true);
    expect(grantsAllow(grants, "po:approve", { departmentId: DEPT_ART }, "strict", deptCampus)).toBe(true);
    expect(grantsAllow(grants, "po:approve", {}, "strict")).toBe(true);
  });

  it("campus-scoped grants cover that campus and its departments only", () => {
    const grants = [g("issue:update", "campus", CAMPUS_A)];
    expect(grantsAllow(grants, "issue:update", { campusId: CAMPUS_A })).toBe(true);
    expect(grantsAllow(grants, "issue:update", { departmentId: DEPT_SCI }, "auto", deptCampus)).toBe(true);
    expect(grantsAllow(grants, "issue:update", { campusId: CAMPUS_B })).toBe(false);
  });

  it("department-scoped grants cover only that department", () => {
    const grants = [g("expense:approve", "department", CAMPUS_A, DEPT_SCI)];
    expect(grantsAllow(grants, "expense:approve", { campusId: CAMPUS_A, departmentId: DEPT_SCI })).toBe(true);
    expect(grantsAllow(grants, "expense:approve", { campusId: CAMPUS_A, departmentId: DEPT_ART })).toBe(false);
    expect(grantsAllow(grants, "expense:approve", { campusId: CAMPUS_A })).toBe(false);
  });

  it("org-level targets: strict needs an org grant, auto accepts any grant", () => {
    const grants = [g("vendor:read", "campus", CAMPUS_A)];
    expect(grantsAllow(grants, "vendor:read", {}, "auto")).toBe(true);
    expect(grantsAllow(grants, "vendor:read", {}, "strict")).toBe(false);
  });

  it("anywhere mode only checks the permission exists", () => {
    expect(grantsAllow([g("budget:read", "department", CAMPUS_A, DEPT_SCI)], "budget:read", { campusId: CAMPUS_B }, "anywhere")).toBe(true);
  });
});

describe("permissionScopes", () => {
  it("returns null for org-wide access", () => {
    expect(permissionScopes([g("issue:read", "org"), g("issue:read", "campus", CAMPUS_A)], "issue:read")).toBeNull();
  });
  it("lists campuses and departments otherwise", () => {
    expect(permissionScopes([g("issue:read", "campus", CAMPUS_A), g("issue:read", "department", CAMPUS_A, DEPT_ART)], "issue:read")).toEqual({
      campusIds: [CAMPUS_A], departmentIds: [DEPT_ART],
    });
  });
});

describe("scopeAllows (API key scopes)", () => {
  it("matches exact, resource wildcard and global wildcard", () => {
    expect(scopeAllows(["issue:read"], "issue:read")).toBe(true);
    expect(scopeAllows(["issue:*"], "issue:update")).toBe(true);
    expect(scopeAllows(["*"], "po:approve")).toBe(true);
  });
  it("does not leak across resources or actions", () => {
    expect(scopeAllows(["issue:read"], "issue:update")).toBe(false);
    expect(scopeAllows(["issue:*"], "issues_extra:read")).toBe(false);
    expect(scopeAllows([], "issue:read")).toBe(false);
  });
});
