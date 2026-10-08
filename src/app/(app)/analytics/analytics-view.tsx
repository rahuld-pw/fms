"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, ClipboardList, ListChecks, ShoppingCart, User, Users, Wallet } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars, ColumnChart } from "@/components/shared/charts";
import { CampusSelect } from "@/components/shared/fields";
import { useMoney } from "@/components/shared/format";
import { Stat } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

type N = number | null;
type Point = { t: string } & Record<string, number | string>;
type Breakdown = { label: string; value: number }[];
export interface OrgAnalytics {
  range: { from: string; to: string; days: number; bucket: "day" | "week" | "month" };
  scope: { level: "organisation" | "campus" | "department" | "personal"; campuses: string[]; departments: string[]; roles: string[]; direct_reports: number };
  modules: string[];
  me: {
    tasks_completed: number; tasks_on_time_pct: N; tasks_open: number; tasks_overdue: number;
    issues_reported: N; issues_resolved: N; work_orders_completed: N; claims_amount: N; approvals_decided: number;
  };
  facility?: {
    issues_opened: number; issues_resolved: number; issues_open: number; issues_overdue: number; sla_met_pct: N;
    avg_resolution_hours: N; avg_rating: N; open_by_priority: Record<string, number>; by_category: Breakdown;
    work_orders_completed: number; work_orders_open: number; maintenance_cost: number; series: Point[];
  };
  expense?: {
    claims_submitted: number; approved_amount: number; paid_amount: number; pending_count: number; pending_amount: number;
    avg_approval_hours: N; by_category: Breakdown; series: Point[];
  };
  po?: { po_count: number; po_value: number; pending_count: number; avg_approval_hours: N; by_status: Record<string, number>; top_vendors: Breakdown; series: Point[] };
  tasks?: { created: number; completed: number; open: number; overdue: number; on_time_pct: N; by_status: Record<string, number>; series: Point[] };
  people: { user_id: string; name: string | null; open_items: number; overdue_tasks: number; completed: number; direct_report: boolean }[];
}

export const RANGES = [7, 30, 90, 365] as const;

/** Bucket label: series timestamps are local to the organisation already. */
export function bucketLabel(t: string, bucket: string, locale: string) {
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, bucket === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "short", timeZone: "UTC" }).format(d);
}

const pct = (v: N) => (v === null || v === undefined ? "—" : `${v}%`);
const hours = (v: N) => (v === null || v === undefined ? "—" : v >= 48 ? `${Math.round(v / 24)}d` : `${v}h`);

export function AnalyticsView() {
  const { campuses } = useSession();
  const { t, locale } = useT();
  const money = useMoney();
  const [days, setDays] = useState<number>(30);
  const [campus, setCampus] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", days, campus],
    queryFn: () => api<OrgAnalytics>(`/analytics?days=${days}${campus ? `&campus_id=${campus}` : ""}`),
  });
  const x = (v: string) => bucketLabel(v, data?.range.bucket ?? "day", locale);
  const level = data?.scope.level;
  const scopeText =
    level === "organisation" ? t("analytics.scope.organisation")
    : level === "campus" ? t("analytics.scope.campus", { names: data!.scope.campuses.join(", ") })
    : level === "department" ? t("analytics.scope.department", { names: data!.scope.departments.join(", ") })
    : level === "personal" ? t("analytics.scope.personal") : "";
  const ScopeIcon = level === "organisation" ? Building2 : level === "personal" ? User : Users;
  const showPeople = !!data && (level !== "personal" || data.scope.direct_reports > 0) && data.people.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {data && <ScopeIcon className="size-4 shrink-0" />}
          <span className="truncate">{scopeText}</span>
          {data?.scope.roles.slice(0, 3).map((r) => <Badge key={r} tone="neutral" className="hidden sm:inline-flex">{r}</Badge>)}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {level === "organisation" && campuses.length > 1 && (
            <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><CampusSelect value={campus} onChange={setCampus} allowEmpty /></div>
          )}
          <NativeSelect className="min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label={t("analytics.range")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((d) => <option key={d} value={d}>{t("analytics.lastDays", { n: d })}</option>)}
          </NativeSelect>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <Section icon={User} title={t("analytics.me.title")} description={t("analytics.me.description", { n: data.range.days })}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {data.modules.includes("tasks") && <>
                <Stat label={t("analytics.me.tasksCompleted")} value={data.me.tasks_completed} hint={data.me.tasks_on_time_pct !== null ? t("analytics.onTime", { v: pct(data.me.tasks_on_time_pct) }) : undefined} />
                <Stat label={t("analytics.me.tasksOpen")} value={data.me.tasks_open} hint={data.me.tasks_overdue ? t("analytics.overdueN", { n: data.me.tasks_overdue }) : undefined} tone={data.me.tasks_overdue ? "danger" : "default"} href="/tasks" />
              </>}
              {data.me.issues_reported !== null && <Stat label={t("analytics.me.issuesReported")} value={data.me.issues_reported} />}
              {data.me.issues_resolved !== null && <Stat label={t("analytics.me.issuesResolved")} value={(data.me.issues_resolved ?? 0) + (data.me.work_orders_completed ?? 0)} hint={t("analytics.me.issuesResolvedHint")} />}
              {data.me.claims_amount !== null && <Stat label={t("analytics.me.claims")} value={money(data.me.claims_amount, true)} />}
              {data.me.approvals_decided > 0 && <Stat label={t("analytics.me.approvals")} value={data.me.approvals_decided} />}
            </div>
          </Section>

          {showPeople && (
            <Section icon={Users} title={level === "personal" ? t("analytics.team.myTeam") : t("analytics.team.title")} description={t("analytics.team.description")}>
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead className="border-b text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t("analytics.team.person")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("analytics.team.open")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("analytics.team.overdue")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("analytics.team.done", { n: data.range.days })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.people.map((p) => (
                        <tr key={p.user_id}>
                          <td className="px-4 py-2">
                            <span className="font-medium">{p.name ?? "—"}</span>
                            {p.direct_report && <Badge tone="outline" className="ml-2">{t("analytics.team.directReport")}</Badge>}
                          </td>
                          <td className="px-4 py-2 text-right tabular">{p.open_items}</td>
                          <td className={`px-4 py-2 text-right tabular ${p.overdue_tasks ? "font-medium text-destructive" : ""}`}>{p.overdue_tasks}</td>
                          <td className="px-4 py-2 text-right tabular">{p.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </Section>
          )}

          {data.facility && (
            <Section icon={ClipboardList} title={t("modules.facility")}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t("analytics.facility.opened")} value={data.facility.issues_opened} hint={t("analytics.facility.resolvedN", { n: data.facility.issues_resolved })} />
                <Stat label={t("analytics.facility.open")} value={data.facility.issues_open} hint={data.facility.issues_overdue ? t("analytics.facility.pastSla", { n: data.facility.issues_overdue }) : undefined} tone={data.facility.issues_overdue ? "danger" : "default"} href="/facility/issues" />
                <Stat label={t("analytics.facility.slaMet")} value={pct(data.facility.sla_met_pct)} hint={t("analytics.facility.avgResolution", { v: hours(data.facility.avg_resolution_hours) })} tone={data.facility.sla_met_pct !== null && data.facility.sla_met_pct < 80 ? "warning" : "default"} />
                <Stat label={t("analytics.facility.workOrders")} value={data.facility.work_orders_completed} hint={t("analytics.facility.woOpen", { n: data.facility.work_orders_open, cost: money(data.facility.maintenance_cost, true) })} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader><CardTitle>{t("analytics.facility.trend")}</CardTitle></CardHeader>
                  <CardContent>
                    <ColumnChart
                      data={data.facility.series}
                      x="t"
                      formatX={x}
                      series={[{ key: "opened", label: t("analytics.facility.seriesOpened"), color: "var(--chart-1)" }, { key: "resolved", label: t("analytics.facility.seriesResolved"), color: "var(--chart-2)" }]}
                      ariaLabel={t("analytics.facility.trend")}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t("analytics.facility.byCategory")}</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {data.facility.by_category.length ? <BreakdownBars rows={data.facility.by_category} /> : <Empty />}
                    <PriorityRow counts={data.facility.open_by_priority} />
                  </CardContent>
                </Card>
              </div>
            </Section>
          )}

          {data.expense && (
            <Section icon={Wallet} title={t("modules.expense")}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t("analytics.expense.approved")} value={money(data.expense.approved_amount, true)} hint={t("analytics.expense.paid", { v: money(data.expense.paid_amount, true) })} />
                <Stat label={t("analytics.expense.submitted")} value={data.expense.claims_submitted} />
                <Stat label={t("analytics.expense.pending")} value={data.expense.pending_count} hint={money(data.expense.pending_amount, true)} tone={data.expense.pending_count ? "warning" : "default"} href="/expense/claims" />
                <Stat label={t("analytics.avgApproval")} value={hours(data.expense.avg_approval_hours)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader><CardTitle>{t("analytics.expense.trend")}</CardTitle></CardHeader>
                  <CardContent>
                    <ColumnChart data={data.expense.series} x="t" formatX={x} formatY={(v) => money(v, true)} series={[{ key: "approved", label: t("analytics.expense.approved"), color: "var(--chart-1)" }]} ariaLabel={t("analytics.expense.trend")} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t("analytics.expense.byCategory")}</CardTitle></CardHeader>
                  <CardContent>{data.expense.by_category.length ? <BreakdownBars rows={data.expense.by_category.map((r) => ({ ...r, value: Number(r.value) }))} format={(v) => money(v, true)} /> : <Empty />}</CardContent>
                </Card>
              </div>
            </Section>
          )}

          {data.po && (
            <Section icon={ShoppingCart} title={t("modules.po")}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t("analytics.po.value")} value={money(data.po.po_value, true)} hint={t("analytics.po.count", { n: data.po.po_count })} />
                <Stat label={t("analytics.po.pending")} value={data.po.pending_count} tone={data.po.pending_count ? "warning" : "default"} href="/po/orders" />
                <Stat label={t("analytics.avgApproval")} value={hours(data.po.avg_approval_hours)} />
                <Stat label={t("analytics.po.vendors")} value={data.po.top_vendors.length} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader><CardTitle>{t("analytics.po.trend")}</CardTitle></CardHeader>
                  <CardContent>
                    <ColumnChart data={data.po.series} x="t" formatX={x} formatY={(v) => money(v, true)} series={[{ key: "value", label: t("analytics.po.value"), color: "var(--chart-1)" }]} ariaLabel={t("analytics.po.trend")} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t("analytics.po.topVendors")}</CardTitle></CardHeader>
                  <CardContent>{data.po.top_vendors.length ? <BreakdownBars rows={data.po.top_vendors.map((r) => ({ ...r, value: Number(r.value) }))} format={(v) => money(v, true)} /> : <Empty />}</CardContent>
                </Card>
              </div>
            </Section>
          )}

          {data.tasks && (
            <Section icon={ListChecks} title={t("modules.tasks")}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t("analytics.tasks.completed")} value={data.tasks.completed} hint={data.tasks.on_time_pct !== null ? t("analytics.onTime", { v: pct(data.tasks.on_time_pct) }) : undefined} />
                <Stat label={t("analytics.tasks.created")} value={data.tasks.created} />
                <Stat label={t("analytics.tasks.open")} value={data.tasks.open} />
                <Stat label={t("analytics.tasks.overdue")} value={data.tasks.overdue} tone={data.tasks.overdue ? "danger" : "default"} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader><CardTitle>{t("analytics.tasks.trend")}</CardTitle></CardHeader>
                  <CardContent>
                    <ColumnChart
                      data={data.tasks.series}
                      x="t"
                      formatX={x}
                      series={[{ key: "created", label: t("analytics.tasks.created"), color: "var(--chart-1)" }, { key: "completed", label: t("analytics.tasks.completed"), color: "var(--chart-2)" }]}
                      ariaLabel={t("analytics.tasks.trend")}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t("analytics.tasks.byStatus")}</CardTitle></CardHeader>
                  <CardContent>
                    {Object.keys(data.tasks.by_status).length
                      ? <BreakdownBars rows={["todo", "in_progress", "blocked", "done", "cancelled"].filter((k) => data.tasks!.by_status[k]).map((k) => ({ label: t(`status.${k}`, undefined, humanize(k)), value: data.tasks!.by_status[k] }))} />
                      : <Empty />}
                  </CardContent>
                </Card>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export function Section({ icon: Icon, title, description, children }: { icon: React.ComponentType<{ className?: string }>; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="size-4 text-muted-foreground" />{title}</h2>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {children}
    </section>
  );
}

function PriorityRow({ counts }: { counts: Record<string, number> }) {
  const { t } = useT();
  const keys = ["critical", "high", "medium", "low"].filter((k) => counts[k]);
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t pt-3 text-xs">
      <span className="text-muted-foreground">{t("analytics.facility.openByPriority")}</span>
      {keys.map((k) => (
        <Badge key={k} tone={k === "critical" || k === "high" ? "red" : "neutral"}>{t(`priority.${k}`, undefined, humanize(k))}: {counts[k]}</Badge>
      ))}
    </div>
  );
}

export function Empty() {
  const { t } = useT();
  return <p className="py-6 text-center text-sm text-muted-foreground">{t("analytics.empty")}</p>;
}
