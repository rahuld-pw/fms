"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/shared/data-table";
import { DueDate, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { isActing, ResourceFormDialog, useAction, type FieldSpec } from "@/components/shared/resource-form";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { humanize } from "@/lib/utils/format";

const enumOpt = (t: TFunction, field: string) => (v: string) => ({ value: v, label: t(`enum.${field}.${v}`, undefined, humanize(v)) });
const priorityOpt = (t: TFunction) => (v: string) => ({ value: v, label: t(`priority.${v}`, undefined, humanize(v)) });

const pmFields = (t: TFunction): FieldSpec[] => [
  { name: "title", label: t("ui.title"), required: true, full: true },
  { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
  { name: "asset_id", label: t("ui.asset"), type: "resource", endpoint: "/assets", hintKey: "asset_tag" },
  { name: "location_id", label: t("facility.maintenance.pm.locationIfNoAsset"), type: "resource", endpoint: "/locations" },
  { name: "trigger_type", label: t("facility.maintenance.pm.trigger"), type: "select", required: true, options: [{ value: "time", label: t("facility.maintenance.pm.timeBased") }, { value: "usage", label: t("facility.maintenance.pm.usageBased") }] },
  { name: "frequency", label: t("facility.maintenance.pm.frequency"), type: "select", options: ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly", "custom_days"].map(enumOpt(t, "frequency")), hidden: (v) => v.trigger_type === "usage" },
  { name: "interval_days", label: t("facility.maintenance.pm.everyNDays"), type: "number", hidden: (v) => v.frequency !== "custom_days" },
  { name: "next_due_date", label: t("facility.maintenance.nextDue"), type: "date", hidden: (v) => v.trigger_type === "usage" },
  { name: "usage_interval", label: t("facility.maintenance.pm.everyMeterUnits"), type: "number", hidden: (v) => v.trigger_type !== "usage" },
  { name: "lead_days", label: t("facility.maintenance.pm.leadDays"), type: "number" },
  { name: "checklist_template_id", label: t("facility.workOrders.checklist"), type: "resource", endpoint: "/checklist-templates" },
  { name: "priority", label: t("ui.priority"), type: "select", required: true, options: ["low", "medium", "high", "critical"].map(priorityOpt(t)) },
  { name: "assignee_id", label: t("facility.workOrders.assignTo"), type: "user" },
  { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors?status=approved" },
  { name: "amc_contract_id", label: t("facility.maintenance.pm.underAmc"), type: "resource", endpoint: "/amc-contracts", labelKey: "title" },
  { name: "requires_vendor_booking", label: t("facility.maintenance.pm.vendorConfirm"), type: "switch" },
];

export const amcFields = (t: TFunction): FieldSpec[] => [
  { name: "title", label: t("ui.title"), required: true, full: true },
  { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors?status=approved", required: true },
  { name: "campus_id", label: t("ui.campus"), type: "campus" },
  { name: "contract_number", label: t("facility.maintenance.amc.contractNumber") },
  { name: "contract_type", label: t("ui.type"), type: "select", options: ["comprehensive", "non_comprehensive", "labour_only"].map(enumOpt(t, "contractType")) },
  { name: "start_date", label: t("facility.maintenance.amc.start"), type: "date", required: true },
  { name: "end_date", label: t("facility.maintenance.amc.end"), type: "date", required: true },
  { name: "value", label: t("facility.maintenance.amc.contractValue"), type: "money" },
  { name: "visits_included", label: t("facility.maintenance.amc.visitsIncluded"), type: "number" },
  { name: "visit_frequency", label: t("facility.maintenance.amc.visitFrequency"), type: "select", options: ["monthly", "quarterly", "half_yearly", "yearly", "on_call"].map(enumOpt(t, "frequency")) },
  { name: "renewal_reminder_days", label: t("facility.maintenance.amc.remindBeforeEnd"), type: "number" },
  { name: "coverage", label: t("facility.maintenance.amc.coverage"), type: "textarea" },
];

const complianceFields = (t: TFunction): FieldSpec[] => [
  { name: "title", label: t("ui.title"), required: true, full: true },
  { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
  { name: "compliance_type", label: t("ui.type"), type: "select", required: true, options: ["fire_safety", "lift", "water_tank", "electrical", "pest_control", "dg_set", "building_safety", "pollution", "food_safety", "transport", "other"].map(enumOpt(t, "complianceType")) },
  { name: "authority", label: t("facility.maintenance.comp.authority") },
  { name: "frequency_months", label: t("facility.maintenance.comp.everyNMonths"), type: "number", required: true },
  { name: "last_done_on", label: t("facility.maintenance.comp.lastDone"), type: "date" },
  { name: "next_due_on", label: t("facility.maintenance.nextDue"), type: "date", required: true },
  { name: "reminder_days", label: t("facility.maintenance.comp.remindBefore"), type: "number" },
  { name: "responsible_user_id", label: t("facility.maintenance.comp.responsible"), type: "user" },
  { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors?status=approved" },
  { name: "auto_create_work_order", label: t("facility.maintenance.comp.autoCreate"), type: "switch" },
  { name: "notes", label: t("ui.notes"), type: "textarea" },
];

export function MaintenanceTabs() {
  const { t } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const { campuses } = useSession();
  const tab = params.get("tab") ?? "calendar";
  const [dialog, setDialog] = useState<"pm" | "amc" | "compliance" | null>(null);
  const complete = useAction({ success: t("facility.maintenance.comp.recorded"), invalidate: ["/compliance-items"] });
  const campus0 = campuses.length === 1 ? campuses[0].id : "";
  return (
    <>
      <Tabs value={tab} onValueChange={(v) => router.replace(`?tab=${v}`)}>
        <TabsList>
          <TabsTrigger value="calendar">{t("facility.maintenance.tabCalendar")}</TabsTrigger>
          <TabsTrigger value="pm">{t("facility.maintenance.tabPm")}</TabsTrigger>
          <TabsTrigger value="amc">{t("facility.maintenance.tabAmc")}</TabsTrigger>
          <TabsTrigger value="compliance">{t("facility.maintenance.tabCompliance")}</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          <MaintenanceCalendar />
        </TabsContent>
        <TabsContent value="pm">
          <DataTable
            id="pm"
            endpoint="/pm-schedules"
            defaultSort="next_due_date"
            exportable
            columns={[
              { key: "title", header: t("facility.maintenance.pm.colSchedule"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
              { key: "asset", header: t("facility.workOrders.colAssetLocation"), render: (r) => r.asset ? `${r.asset.asset_tag} · ${r.asset.name}` : r.location?.name },
              { key: "trigger_type", header: t("facility.maintenance.pm.trigger"), render: (r) => (r.trigger_type === "usage" ? t("facility.maintenance.pm.everyUnits", { n: r.usage_interval }) : r.frequency ? t(`enum.frequency.${r.frequency}`, undefined, humanize(r.frequency)) : humanize(r.frequency)) },
              { key: "next_due_date", header: t("facility.maintenance.nextDue"), sortable: true, render: (r) => (r.trigger_type === "usage" ? t("facility.maintenance.pm.onMeter") : <DueDate value={r.next_due_date} />) },
              { key: "priority", header: t("ui.priority"), render: (r) => <PriorityLabel priority={r.priority} /> },
              { key: "assignee", header: t("facility.maintenance.pm.colAssigned"), render: (r) => (r.vendor ? r.vendor.name : <UserChip name={r.assignee?.full_name} />) },
              { key: "active", header: t("ui.active"), render: (r) => (r.active ? t("ui.yes") : t("facility.maintenance.pm.paused")) },
            ]}
            filters={[{ key: "active", label: t("ui.active"), type: "boolean" }, { key: "trigger_type", label: t("facility.maintenance.pm.trigger"), type: "select", options: ["time", "usage"].map(enumOpt(t, "triggerType")) }]}
            toolbar={can("pm:create") && <Button size="sm" onClick={() => setDialog("pm")}><Plus /> {t("facility.maintenance.pm.newSchedule")}</Button>}
          />
        </TabsContent>
        <TabsContent value="amc">
          <DataTable
            id="amc"
            endpoint="/amc-contracts"
            defaultSort="end_date"
            columns={[
              { key: "title", header: t("facility.maintenance.amc.colContract"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
              { key: "vendor", header: t("ui.vendor"), render: (r) => r.vendor?.name },
              { key: "contract_type", header: t("ui.type"), render: (r) => (r.contract_type ? t(`enum.contractType.${r.contract_type}`, undefined, humanize(r.contract_type)) : humanize(r.contract_type)) },
              { key: "start_date", header: t("facility.maintenance.amc.start"), sortable: true },
              { key: "end_date", header: t("facility.maintenance.amc.colEnds"), sortable: true, render: (r) => <DueDate value={r.end_date} done={r.status !== "active"} /> },
              { key: "visits_included", header: t("facility.maintenance.amc.colVisits"), render: (r) => r.visits_included || "—" },
              { key: "assets", header: t("facility.maintenance.amc.colAssets"), render: (r) => r.assets?.length ?? 0 },
              { key: "value", header: t("facility.maintenance.amc.colValue"), align: "right", render: (r) => <Money value={r.value} /> },
              { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            ]}
            filters={[{ key: "status", label: t("ui.status"), type: "multi", options: ["active", "expired", "renewed", "terminated"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) }]}
            toolbar={can("amc:create") && <Button size="sm" onClick={() => setDialog("amc")}><Plus /> {t("facility.maintenance.amc.newAmc")}</Button>}
          />
        </TabsContent>
        <TabsContent value="compliance">
          <DataTable
            id="compliance"
            endpoint="/compliance-items"
            defaultSort="next_due_on"
            columns={[
              { key: "title", header: t("facility.maintenance.comp.colRequirement"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
              { key: "compliance_type", header: t("ui.type"), render: (r) => (r.compliance_type ? t(`enum.complianceType.${r.compliance_type}`, undefined, humanize(r.compliance_type)) : humanize(r.compliance_type)) },
              { key: "campus", header: t("ui.campus"), render: (r) => r.campus?.name },
              { key: "authority", header: t("facility.maintenance.comp.authority"), defaultHidden: true },
              { key: "last_done_on", header: t("facility.maintenance.comp.lastDone") },
              { key: "next_due_on", header: t("facility.maintenance.nextDue"), sortable: true, render: (r) => <DueDate value={r.next_due_on} /> },
              { key: "responsible", header: t("facility.maintenance.comp.responsible"), render: (r) => <UserChip name={r.responsible?.full_name} /> },
              {
                key: "actions",
                header: "",
                pinned: true,
                render: (r) =>
                  can("compliance:update", { campusId: r.campus_id }, "auto") && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={complete.isPending}
                      loading={isActing(complete, `/compliance-items/${r.id}/complete`)}
                      onClick={(e) => {
                        e.stopPropagation();
                        complete.mutate({ path: `/compliance-items/${r.id}/complete`, body: { done_on: new Date().toISOString().slice(0, 10) } });
                      }}
                    >
                      {t("facility.maintenance.comp.markDoneToday")}
                    </Button>
                  ),
              },
            ]}
            filters={[{ key: "next_due_on", label: t("ui.due"), type: "date-range" }]}
            toolbar={can("compliance:create") && <Button size="sm" onClick={() => setDialog("compliance")}><Plus /> {t("facility.maintenance.comp.newItem")}</Button>}
          />
        </TabsContent>
      </Tabs>
      <ResourceFormDialog open={dialog === "pm"} onOpenChange={(o) => !o && setDialog(null)} title={t("facility.maintenance.pm.newTitle")} endpoint="/pm-schedules" fields={pmFields(t)} defaultValues={{ campus_id: campus0, trigger_type: "time", frequency: "monthly", priority: "medium", lead_days: 3 }} invalidate={["/pm-schedules"]} />
      <ResourceFormDialog open={dialog === "amc"} onOpenChange={(o) => !o && setDialog(null)} title={t("facility.maintenance.amc.newTitle")} endpoint="/amc-contracts" fields={amcFields(t)} defaultValues={{ contract_type: "comprehensive", renewal_reminder_days: 45, visits_included: 4 }} invalidate={["/amc-contracts"]} />
      <ResourceFormDialog open={dialog === "compliance"} onOpenChange={(o) => !o && setDialog(null)} title={t("facility.maintenance.comp.newTitle")} endpoint="/compliance-items" fields={complianceFields(t)} defaultValues={{ campus_id: campus0, frequency_months: 12, reminder_days: 30, auto_create_work_order: true }} invalidate={["/compliance-items"]} />
    </>
  );
}

interface Cal {
  work_orders: { id: string; number: string; title: string; status: string; scheduled_for: string | null; due_at: string | null }[];
  pm_due: { id: string; title: string; next_due_date: string }[];
  compliance_due: { id: string; title: string; next_due_on: string }[];
}

function MaintenanceCalendar() {
  const { t, locale } = useT();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [picked, setPicked] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const router = useRouter();
  const from = startOfWeek(month, { weekStartsOn: 1 });
  const to = addDays(startOfWeek(endOfMonth(month), { weekStartsOn: 1 }), 6);
  const { data } = useQuery({
    queryKey: ["maintenance-calendar", month.toISOString()],
    queryFn: () => api<Cal>(`/maintenance/calendar?from=${format(from, "yyyy-MM-dd")}T00:00:00Z&to=${format(to, "yyyy-MM-dd")}T23:59:59Z`),
  });
  const byDay = useMemo(() => {
    const m = new Map<string, { label: string; kind: "wo" | "pm" | "comp"; href: string; overdue?: boolean }[]>();
    const push = (d: string | null | undefined, e: { label: string; kind: "wo" | "pm" | "comp"; href: string; overdue?: boolean }) => {
      if (!d) return;
      const k = d.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), e]);
    };
    for (const w of data?.work_orders ?? []) push(w.scheduled_for ?? w.due_at, { label: `${w.number} ${w.title}`, kind: "wo", href: `/facility/work-orders/${w.id}` });
    for (const p of data?.pm_due ?? []) push(p.next_due_date, { label: p.title, kind: "pm", href: "/facility/maintenance?tab=pm" });
    const today = format(new Date(), "yyyy-MM-dd");
    for (const c of data?.compliance_due ?? []) push(c.next_due_on < today ? today : c.next_due_on, { label: c.title, kind: "comp", href: "/facility/maintenance?tab=compliance", overdue: c.next_due_on < today });
    return m;
  }, [data]);
  const days = Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86400000) + 1 }, (_, i) => addDays(from, i));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(startOfMonth(addDays(month, -1)))} aria-label={t("facility.maintenance.cal.prevMonth")}><ChevronLeft /></Button>
        <span className="w-36 text-center text-sm font-medium">{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month)}</span>
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(startOfMonth(addDays(endOfMonth(month), 1)))} aria-label={t("facility.maintenance.cal.nextMonth")}><ChevronRight /></Button>
        <div className="ml-auto flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--chart-1)]" /> {t("facility.workOrders.colWorkOrder")}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--chart-2)]" /> {t("facility.maintenance.cal.pmDue")}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[var(--chart-3)]" /> {t("facility.maintenance.tabCompliance")}</span>
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
          {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => <div key={d} className="py-1.5">{t(`facility.maintenance.cal.${d}`)}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const k = format(d, "yyyy-MM-dd");
            const items = byDay.get(k) ?? [];
            const inMonth = d.getMonth() === month.getMonth();
            const isToday = k === format(new Date(), "yyyy-MM-dd");
            return (
              <div key={k} onClick={() => setPicked(k)} className={cn("min-h-14 cursor-pointer border-r border-b p-1 text-xs [&:nth-child(7n)]:border-r-0 sm:min-h-24 sm:cursor-default", !inMonth && "bg-muted/30 text-muted-foreground", picked === k && "ring-2 ring-primary/40 ring-inset sm:ring-0")}>
                <div className={cn("mb-0.5 inline-flex size-5 items-center justify-center rounded-full", isToday && "bg-primary font-semibold text-primary-foreground")}>{d.getDate()}</div>
                {/* phones: dots only; tap the day for the agenda below */}
                <div className="flex flex-wrap gap-0.5 sm:hidden">
                  {items.slice(0, 6).map((e, i) => <span key={i} className="size-1.5 rounded-full" style={{ background: e.kind === "wo" ? "var(--chart-1)" : e.kind === "pm" ? "var(--chart-2)" : "var(--chart-3)" }} />)}
                </div>
                <div className="hidden flex-col gap-0.5 sm:flex">
                  {items.slice(0, 3).map((e, i) => (
                    <button key={i} onClick={() => router.push(e.href)} className={cn("flex items-center gap-1 truncate rounded px-1 text-left hover:bg-muted", e.overdue && "font-medium text-destructive")} title={e.label}>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.kind === "wo" ? "var(--chart-1)" : e.kind === "pm" ? "var(--chart-2)" : "var(--chart-3)" }} />
                      <span className="truncate">{e.label}</span>
                    </button>
                  ))}
                  {items.length > 3 && <span className="px-1 text-muted-foreground">+{items.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="sm:hidden">
        <div className="border-b px-4 py-2 text-sm font-medium">{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${picked}T12:00:00`))}</div>
        <ul className="divide-y">
          {(byDay.get(picked) ?? []).map((e, i) => (
            <li key={i}>
              <button onClick={() => router.push(e.href)} className={cn("flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm active:bg-muted", e.overdue && "font-medium text-destructive")}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: e.kind === "wo" ? "var(--chart-1)" : e.kind === "pm" ? "var(--chart-2)" : "var(--chart-3)" }} />
                <span className="truncate">{e.label}</span>
              </button>
            </li>
          ))}
          {!(byDay.get(picked) ?? []).length && <li className="px-4 py-3 text-sm text-muted-foreground">{t("facility.maintenance.cal.nothing")}</li>}
        </ul>
      </Card>
    </div>
  );
}
