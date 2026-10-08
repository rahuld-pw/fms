"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars, ColumnChart } from "@/components/shared/charts";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";
import { bucketLabel, RANGES } from "../../analytics/analytics-view";

interface Dashboard {
  days: number;
  bucket: "day" | "week" | "month";
  open: number;
  overdue: number;
  due_week: number;
  blocked: number;
  created: number;
  completed: number;
  on_time_pct: number | null;
  avg_days_to_complete: number | null;
  by_status: Record<string, number>;
  open_by_priority: Record<string, number>;
  series: { t: string; created: number; completed: number }[];
  projects: { id: string; name: string; open: number; overdue: number; done: number; total: number }[];
  people: { user_id: string; name: string | null; open: number; overdue: number }[];
}

const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITIES = ["urgent", "high", "medium", "low"];

/** Tasks overview: progress across the tasks the signed-in person can see. */
export default function TasksOverviewPage() {
  const { t, locale } = useT();
  const [days, setDays] = useState<number>(30);
  const { data, isLoading } = useQuery({ queryKey: ["tasks", "dashboard", days], queryFn: () => api<Dashboard>(`/tasks/dashboard?days=${days}`) });
  const empty = <p className="text-sm text-muted-foreground">{t("tasks.overview.noData")}</p>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("tasks.overview.title")}
        description={t("tasks.overview.description")}
        actions={
          <NativeSelect className="w-full sm:w-44" aria-label={t("analytics.range")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((d) => <option key={d} value={d}>{t("analytics.lastDays", { n: d })}</option>)}
          </NativeSelect>
        }
      />
      {isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("analytics.tasks.open")} value={data.open} hint={data.blocked ? t("tasks.overview.blockedN", { n: data.blocked }) : undefined} />
            <Stat label={t("analytics.tasks.overdue")} value={data.overdue} tone={data.overdue ? "danger" : "good"} />
            <Stat label={t("tasks.overview.dueWeek")} value={data.due_week} tone={data.due_week ? "warning" : "default"} />
            <Stat
              label={t("analytics.tasks.completed")}
              value={data.completed}
              hint={[
                data.on_time_pct !== null ? t("analytics.onTime", { v: `${data.on_time_pct}%` }) : null,
                data.avg_days_to_complete !== null ? t("tasks.overview.avgDays", { v: data.avg_days_to_complete }) : null,
              ].filter(Boolean).join(" · ") || undefined}
              tone="good"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>{t("analytics.tasks.trend")}</CardTitle></CardHeader>
              <CardContent>
                <ColumnChart
                  data={data.series}
                  x="t"
                  formatX={(v) => bucketLabel(v, data.bucket, locale)}
                  series={[{ key: "created", label: t("analytics.tasks.created"), color: "var(--chart-1)" }, { key: "completed", label: t("analytics.tasks.completed"), color: "var(--chart-2)" }]}
                  ariaLabel={t("analytics.tasks.trend")}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("analytics.tasks.byStatus")}</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(data.by_status).length
                  ? <BreakdownBars rows={STATUSES.filter((k) => data.by_status[k]).map((k) => ({ label: t(`status.${k}`, undefined, humanize(k)), value: data.by_status[k] }))} />
                  : empty}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>{t("tasks.overview.projects")}</CardTitle></CardHeader>
              <CardContent className="px-0">
                {data.projects.length === 0 ? <div className="px-6">{empty}</div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="px-6 py-2 text-left font-medium">{t("tasks.overview.project")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("analytics.team.open")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("tasks.overview.overdue")}</th>
                          <th className="w-32 px-6 py-2 text-left font-medium">{t("tasks.overview.progress")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.projects.map((p) => {
                          const pctDone = p.total ? Math.round((100 * p.done) / p.total) : 0;
                          return (
                            <tr key={p.id} className="border-b last:border-0">
                              <td className="max-w-0 truncate px-6 py-2"><Link href={`/tasks/projects/${p.id}`} className="hover:underline">{p.name}</Link></td>
                              <td className="px-3 py-2 text-right tabular">{p.open}</td>
                              <td className={`px-3 py-2 text-right tabular ${p.overdue ? "font-medium text-destructive" : ""}`}>{p.overdue}</td>
                              <td className="px-6 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100} aria-label={p.name}>
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${pctDone}%` }} />
                                  </div>
                                  <span className="w-9 text-right text-xs tabular text-muted-foreground">{pctDone}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("tasks.overview.workload")}</CardTitle></CardHeader>
              <CardContent className="px-0">
                {data.people.length === 0 ? <div className="px-6">{empty}</div> : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="px-6 py-2 text-left font-medium">{t("analytics.team.person")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("analytics.team.open")}</th>
                        <th className="px-6 py-2 text-right font-medium">{t("tasks.overview.overdue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.people.map((p) => (
                        <tr key={p.user_id} className="border-b last:border-0">
                          <td className="max-w-0 truncate px-6 py-2">{p.name ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular">{p.open}</td>
                          <td className={`px-6 py-2 text-right tabular ${p.overdue ? "font-medium text-destructive" : ""}`}>{p.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>{t("analytics.facility.openByPriority")}</CardTitle></CardHeader>
            <CardContent>
              {Object.keys(data.open_by_priority).length
                ? <BreakdownBars rows={PRIORITIES.filter((k) => data.open_by_priority[k]).map((k) => ({ label: t(`priority.${k}`, undefined, humanize(k)), value: data.open_by_priority[k] }))} />
                : empty}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
