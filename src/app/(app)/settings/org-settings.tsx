"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardList, ListChecks, Lock, MessageSquareHeart, ShoppingCart, Wallet } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { CrudSection } from "./crud-section";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London", "America/New_York", "UTC"];
const MODULES = [
  { key: "facility", icon: ClipboardList },
  { key: "expense", icon: Wallet },
  { key: "tasks", icon: ListChecks },
  { key: "po", icon: ShoppingCart },
  { key: "surveys", icon: MessageSquareHeart },
];

export function OrgSettings() {
  const { t } = useT();
  const can = useCan();
  const manage = can("org:manage", {}, "strict");
  const { org } = useSession();
  const personal = org.kind === "personal";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={personal ? t("settings.org.workspace") : t("settings.org.organisation")}
        description={personal ? t("settings.org.workspaceDescription") : t("settings.org.orgDescription")}
      />
      {manage ? (
        <>
          <OrgForm />
          <ModulesCard />
          {!personal && <>
          <CrudSection
            title={t("settings.org.campuses.title")}
            endpoint="/campuses"
            createLabel={t("settings.org.campuses.add")}
            createTitle={t("settings.org.campuses.createTitle")}
            editTitle={t("settings.org.campuses.editTitle")}
            columns={[
              { key: "name", header: t("settings.org.campuses.colCampus"), render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: t("ui.code"), className: "font-mono text-xs" },
              { key: "city", header: t("settings.org.campuses.colCity"), hideOnPhone: true },
              { key: "gstin", header: t("settings.org.campuses.colGstin"), className: "font-mono text-xs", hideOnPhone: true },
            ]}
            fields={[
              { name: "name", label: t("ui.name"), required: true },
              { name: "code", label: t("ui.code"), required: true, hint: t("settings.org.campuses.codeHint") },
              { name: "address", label: t("settings.org.campuses.address"), type: "textarea" },
              { name: "city", label: t("settings.org.campuses.city") },
              { name: "state", label: t("settings.org.campuses.state"), hint: t("settings.org.campuses.stateHint") },
              { name: "pincode", label: t("settings.org.campuses.pincode") },
              { name: "gstin", label: t("settings.org.campuses.gstin") },
            ]}
          />
          <CrudSection
            title={t("settings.org.departments.title")}
            endpoint="/departments"
            createLabel={t("settings.org.departments.add")}
            createTitle={t("settings.org.departments.createTitle")}
            editTitle={t("settings.org.departments.editTitle")}
            canDelete
            columns={[
              { key: "name", header: t("settings.org.departments.colDepartment"), render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: t("ui.code"), className: "font-mono text-xs" },
              { key: "campus", header: t("ui.campus"), render: (r) => r.campus?.name ?? t("ui.allCampuses"), hideOnPhone: true },
              { key: "head", header: t("settings.org.departments.colHead"), render: (r) => r.head?.full_name ?? "—", hideOnPhone: true },
            ]}
            fields={(row) => [
              { name: "name", label: t("ui.name"), required: true },
              { name: "code", label: t("ui.code"), required: true },
              { name: "campus_id", label: t("ui.campus"), type: "campus", hint: t("settings.org.departments.campusHint") },
              { name: "head_user_id", label: t("settings.org.departments.head"), type: "user", initialLabel: row?.head?.full_name, hint: t("settings.org.departments.headHint") },
            ]}
            toForm={(r) => ({ name: r.name, code: r.code, campus_id: r.campus_id, head_user_id: r.head_user_id })}
          />
          </>}
        </>
      ) : (
        <Card><CardContent className="pt-4 text-sm text-muted-foreground">{t("settings.org.noAccess")}</CardContent></Card>
      )}
    </div>
  );
}

function OrgForm() {
  const { t } = useT();
  const { org, modules } = useSession();
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
      toast.success(t("settings.org.form.saved"));
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
      <CardHeader><CardTitle>{t("settings.org.form.title")}</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label={t("settings.org.form.name")} className="sm:col-span-2"><Input value={v.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("settings.org.form.timezone")} hint={t("settings.org.form.timezoneHint")}>
          <NativeSelect value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>{ZONES.map((z) => <option key={z}>{z}</option>)}</NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("ui.currency")}><Input value={v.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label={t("settings.org.form.locale")}><Input value={v.locale} onChange={(e) => set("locale", e.target.value)} /></Field>
        </div>
        <Field label={t("settings.org.form.fyStart")}>
          <NativeSelect value={v.fy_start_month} onChange={(e) => set("fy_start_month", e.target.value)}>{MONTHS.map((m) => <option key={m} value={m}>{t(`settings.org.months.m${m}`)}</option>)}</NativeSelect>
        </Field>
        <Field label={t("settings.org.form.academicStart")}>
          <NativeSelect value={v.academic_year_start_month} onChange={(e) => set("academic_year_start_month", e.target.value)}>{MONTHS.map((m) => <option key={m} value={m}>{t(`settings.org.months.m${m}`)}</option>)}</NativeSelect>
        </Field>
        {modules.includes("po") && <>
          <Field label={t("settings.org.form.priceTolerance")}><Input type="number" inputMode="decimal" min="0" max="25" step="0.5" value={v.price_tol} onChange={(e) => set("price_tol", e.target.value)} /></Field>
          <Field label={t("settings.org.form.qtyTolerance")}><Input type="number" inputMode="decimal" min="0" max="25" step="0.5" value={v.qty_tol} onChange={(e) => set("qty_tol", e.target.value)} /></Field>
        </>}
        {modules.includes("facility") && <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>{t("settings.org.form.publicReporting")}<span className="block text-xs text-muted-foreground">{t("settings.org.form.publicReportingHint")}</span></span>
          <Switch checked={v.public_issue_reporting} onCheckedChange={(c) => set("public_issue_reporting", c)} />
        </label>}
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>{t("settings.org.form.captcha")}<span className="block text-xs text-muted-foreground">{t("settings.org.form.captchaHint")}</span></span>
          <Switch checked={v.require_captcha} onCheckedChange={(c) => set("require_captcha", c)} />
        </label>
        <div className="flex justify-end sm:col-span-2"><Button onClick={save} loading={saving} disabled={!form}>{t("ui.saveChanges")}</Button></div>
      </CardContent>
    </Card>
  );
}

function ModulesCard() {
  const { t } = useT();
  const qc = useQueryClient();
  const { org } = useSession();
  const licensed = new Set(org.licensed_modules);
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["org", "modules"], queryFn: () => api<{ module: string; enabled: boolean }[]>("/org/modules") });
  const enabled = new Set((data ?? []).filter((m) => m.enabled).map((m) => m.module));
  const [saving, setSaving] = useState<string | null>(null);
  const toggle = async (module: string, on: boolean) => {
    if (saving) return;
    setSaving(module);
    try {
      await api(`/org/modules/${module}`, { method: "PUT", body: { enabled: on } });
      toast.success(t(on ? "settings.org.modules.enabled" : "settings.org.modules.disabled", { module: t(`settings.org.modules.${module}`) }));
      qc.invalidateQueries({ queryKey: ["org", "modules"] });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("settings.org.modules.title")}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {MODULES.map((m) => (
          <label key={m.key} className={cn("flex min-w-0 items-start gap-3 rounded-md border p-3", !licensed.has(m.key) && "bg-muted/40")}>
            <m.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm font-medium break-words">
              {t(`settings.org.modules.${m.key}`)}
              <span className="block text-xs font-normal text-muted-foreground">{licensed.has(m.key) ? t(`settings.org.modules.${m.key}Description`) : t("settings.org.modules.notInPlan")}</span>
            </span>
            {licensed.has(m.key)
              ? saving === m.key
                ? <Spinner className="mt-0.5" />
                : <Switch checked={enabled.has(m.key)} disabled={!!saving} onCheckedChange={(c) => toggle(m.key, c)} aria-label={t(`settings.org.modules.${m.key}`)} />
              : <Lock className="mt-0.5 size-4 text-muted-foreground" aria-label={t("settings.org.modules.notLicensed")} />}
          </label>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t("settings.org.modules.footnote")}
        </p>
      </CardContent>
    </Card>
  );
}
