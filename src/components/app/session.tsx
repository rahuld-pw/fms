"use client";
import { createContext, useCallback, useContext, useMemo } from "react";
import { grantsAllow, type Grant, type Scope, type ScopeMode } from "@/lib/auth/permissions";

export interface SessionData {
  user: { id: string; email: string | null; full_name: string | null; avatar_path: string | null };
  org: {
    id: string; name: string; slug: string; timezone: string; currency: string; locale: string; fy_start_month: number; logo_path: string | null;
    settings: Record<string, unknown>; kind: "organisation" | "personal"; licensed_modules: string[];
  };
  orgs: { id: string; name: string; slug: string; kind?: string }[];
  isPlatformAdmin: boolean;
  modules: string[];
  permissions: Grant[];
  campuses: { id: string; name: string; code: string }[];
  departments: { id: string; name: string; code: string; campus_id: string | null }[];
}

const Ctx = createContext<SessionData | null>(null);

export function SessionProvider({ value, children }: { value: SessionData; children: React.ReactNode }) {
  return <Ctx value={value}>{children}</Ctx>;
}

/** Session when rendered inside the app; null elsewhere (e.g. the platform console). */
export function useOptionalSession() {
  return useContext(Ctx);
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/**
 * UI permission check (hides what the user cannot do). Enforcement happens on
 * the server and in Postgres RLS; this only mirrors it for a clean interface.
 */
export function useCan() {
  const s = useSession();
  const deptCampus = useMemo(() => new Map(s.departments.map((d) => [d.id, d.campus_id])), [s.departments]);
  return useCallback(
    (permission: string, scope: Scope = {}, mode: ScopeMode = "anywhere") =>
      grantsAllow(s.permissions, permission, scope, mode, (id) => deptCampus.get(id)),
    [s.permissions, deptCampus],
  );
}

export function useModule(module: string) {
  return useSession().modules.includes(module);
}
