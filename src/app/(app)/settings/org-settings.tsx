"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardList, ListChecks, ShoppingCart, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { CrudSection } from "./crud-section";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London", "America/New_York", "UTC"];
const MODULES = [
  { key: "facility", label: "Facility management", description: "Issues, work orders, assets, vendors, maintenance, compliance", icon: ClipboardList },
  { key: "expense", label: "Expense management", description: "Budgets, claims, advances, petty cash", icon: Wallet },
  { key: "tasks", label: "Task management", description: "Projects, tasks, boards and timelines", icon: ListChecks },
  { key: "po", label: "Purchasing", description: "Requisitions, RFQs, purchase orders, receipts, invoices", icon: ShoppingCart },
];

export function OrgSettings() {
  const can = useCan();
  const manage = can("org:manage", {}, "strict");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Organisation" description="Profile, regional settings, modules, campuses and departments." />
      {manage ? (
        <>
          <OrgForm />
          <ModulesCard />
          <CrudSection
            title="Campuses"
            endpoint="/campuses"
            createLabel="Add campus"
            columns={[
              { key: "name", header: "Campus", render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: "Code", className: "font-mono text-xs" },
              { key: "city", header: "City", hideOnPhone: true },
              { key: "gstin", header: "GSTIN", className: "font-mono text-xs", hideOnPhone: true },
            ]}
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "code", label: "Code", required: true, hint: "Used in document numbers, e.g. MAIN" },
              { name: "address", label: "Address", type: "textarea" },
              { name: "city", label: "City" },
              { name: "state", label: "State", hint: "Determines CGST+SGST vs IGST on POs" },
              { name: "pincode", label: "PIN code" },
              { name: "gstin", label: "GSTIN" },
            ]}
          />
          <CrudSection
            title="Departments"
            endpoint="/departments"
            createLabel="Add department"
            canDelete
            columns={[
              { key: "name", header: "Department", render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: "Code", className: "font-mono text-xs" },
              { key: "campus", header: "Campus", render: (r) => r.campus?.name ?? "All campuses", hideOnPhone: true },
              { key: "head", header: "Head", render: (r) => r.head?.full_name ?? "—", hideOnPhone: true },
            ]}
            fields={(row) => [
              { name: "name", label: "Name", required: true },
              { name: "code", label: "Code", required: true },
              { name: "campus_id", label: "Campus", type: "campus", hint: "Leave empty for an org-wide department" },
              { name: "head_user_id", label: "Head of department", type: "user", initialLabel: row?.head?.full_name, hint: "Used by 'department head' approval steps" },
            ]}
            toForm={(r) => ({ name: r.name, code: r.code, campus_id: r.campus_id, head_user_id: r.head_user_id })}
          />
        </>
      ) : (
        <Card><CardContent className="pt-4 text-sm text-muted-foreground">You don&apos;t have access to organisation settings. Use the menu to manage your profile.</CardContent></Card>
      )}
    </div>
  );
}

function OrgForm() {
  const { org } = useSession();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["org"], queryFn: () => api<any>("/org") });
  const o = data ?? org;
  const s = (o.settings ?? {}) as Record<string, any>;
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const v = form ?? {
    name: o.name, timezone: o.timezone, currency: o.currency, locale: o.locale, fy_start_month: o.fy_start_month, academic_year_start_month: (o as any).academic_year_start_month ?? 4,
    price_tol: s.three_way_match_price_tolerance_pct ?? 0, qty_tol: s.three_way_match_qty_tolerance_pct ?? 0, public_issue_reporting: s.public_issue_reporting !== false, require_captcha: s.require_captcha !== false,
  };
  const set = (k: string, val: unknown) => setForm({ ...v, [k]: val });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api("/org", {
        method: "PATCH",
        body: {
          name: v.name, timezone: v.timezone, currency: v.currency, locale: v.locale, fy_start_month: Number(v.fy_start_month), academic_year_start_month: Number(v.academic_year_start_month),
          settings: { three_way_match_price_tolerance_pct: Number(v.price_tol), three_way_match_qty_tolerance_pct: Number(v.qty_tol), public_issue_reporting: v.public_issue_reporting, require_captcha: v.require_captcha },
        },
      });
      toast.success("Organisation saved");
      setForm(null);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Profile & regional</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation name" className="sm:col-span-2"><Input value={v.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Time zone" hint="Dates are stored in UTC and shown in this zone">
          <NativeSelect value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Currency"><Input value={v.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label="Locale"><Input value={v.locale} onChange={(e) => set("locale", e.target.value)} /></Field>
        </div>
        <Field label="Financial year starts">
          <NativeSelect value={v.fy_start_month} onChange={(e) => set("fy_start_month", e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</NativeSelect>
        </Field>
        <Field label="Academic year starts">
          <NativeSelect value={v.academic_year_start_month} onChange={(e) => set("academic_year_start_month", e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</NativeSelect>
        </Field>
        <Field label="3-way match price tolerance (%)"><Input type="number" inputMode="decimal" min="0" max="25" step="0.5" value={v.price_tol} onChange={(e) => set("price_tol", e.target.value)} /></Field>
        <Field label="3-way match quantity tolerance (%)"><Input type="number" inputMode="decimal" min="0" max="25" step="0.5" value={v.qty_tol} onChange={(e) => set("qty_tol", e.target.value)} /></Field>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>Public issue reporting via QR<span className="block text-xs text-muted-foreground">Anyone scanning a location QR can report without signing in</span></span>
          <Switch checked={v.public_issue_reporting} onCheckedChange={(c) => set("public_issue_reporting", c)} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>Require captcha on public forms<span className="block text-xs text-muted-foreground">Cloudflare Turnstile</span></span>
          <Switch checked={v.require_captcha} onCheckedChange={(c) => set("require_captcha", c)} />
        </label>
        <div className="flex justify-end sm:col-span-2"><Button onClick={save} loading={saving} disabled={!form}>Save changes</Button></div>
      </CardContent>
    </Card>
  );
}

function ModulesCard() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["org", "modules"], queryFn: () => api<{ module: string; enabled: boolean }[]>("/org/modules") });
  const enabled = new Set((data ?? []).filter((m) => m.enabled).map((m) => m.module));
  const toggle = async (module: string, on: boolean) => {
    try {
      await api(`/org/modules/${module}`, { method: "PUT", body: { enabled: on } });
      toast.success(`${MODULES.find((m) => m.key === module)?.label} ${on ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["org", "modules"] });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Modules</CardTitle></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {MODULES.map((m) => (
          <label key={m.key} className="flex items-start gap-3 rounded-md border p-3">
            <m.icon className="mt-0.5 size-4 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">{m.label}<span className="block text-xs font-normal text-muted-foreground">{m.description}</span></span>
            <Switch checked={enabled.has(m.key)} onCheckedChange={(c) => toggle(m.key, c)} aria-label={m.label} />
          </label>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">Disabled modules are hidden from navigation and their API endpoints return 403. Data is kept.</p>
      </CardContent>
    </Card>
  );
}
