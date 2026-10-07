"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "@/components/app/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars, ColumnChart } from "@/components/shared/charts";
import { CampusSelect } from "@/components/shared/fields";
import { Stat } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";

interface Dash {
  issues_by_status: Record<string, number>;
  open_by_priority: Record<string, number>;
  sla_breached: number;
  sla_met_pct_30d: number | null;
  avg_resolution_hours_30d: number | null;
  avg_rating_90d: number | null;
  work_orders_open: number;
  work_orders_overdue: number;
  pm_completion_pct_90d: number | null;
  assets_by_status: Record<string, number>;
  compliance_due_30d: number;
  compliance_overdue: number;
  issues_trend: { day: string; opened: number; resolved: number }[];
}

export function FacilityDashboard() {
  const { campuses } = useSession();
  const [campus, setCampus] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["facility-dashboard", campus],
    queryFn: () => api<Dash>(`/facility/dashboard${campus ? `?campus_id=${campus}` : ""}`),
  });
  const open = data ? Object.values(data.open_by_priority).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="flex flex-col gap-4">
      {campuses.length > 1 && (
        <div className="w-full sm:w-64">
          <CampusSelect value={campus} onChange={setCampus} allowEmpty />
        </div>
      )}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open issues" value={open} href="/facility/issues?status=open,acknowledged,assigned,in_progress,on_hold,reopened" />
            <Stat label="SLA breached (open)" value={data.sla_breached} tone={data.sla_breached ? "danger" : "good"} href="/facility/issues?escalation_level=2" />
            <Stat label="SLA met (30 days)" value={data.sla_met_pct_30d === null ? "—" : `${data.sla_met_pct_30d}%`} hint={data.avg_resolution_hours_30d ? `avg ${data.avg_resolution_hours_30d} h to resolve` : undefined} />
            <Stat label="Reporter rating (90 days)" value={data.avg_rating_90d ? `${data.avg_rating_90d} / 5` : "—"} />
            <Stat label="Open work orders" value={data.work_orders_open} hint={`${data.work_orders_overdue} overdue`} tone={data.work_orders_overdue ? "warning" : "default"} href="/facility/work-orders" />
            <Stat label="PM completed on time (90 days)" value={data.pm_completion_pct_90d === null ? "—" : `${data.pm_completion_pct_90d}%`} href="/facility/maintenance" />
            <Stat label="Compliance due in 30 days" value={data.compliance_due_30d} hint={`${data.compliance_overdue} overdue`} tone={data.compliance_overdue ? "danger" : "default"} href="/facility/maintenance?tab=compliance" />
            <Stat label="Assets in use" value={data.assets_by_status.in_use ?? 0} hint={`${data.assets_by_status.under_repair ?? 0} under repair`} href="/facility/assets" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Issues opened vs resolved</CardTitle>
                  <CardDescription>Last 30 days</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ColumnChart
                  ariaLabel="Issues opened and resolved per day over the last 30 days"
                  data={data.issues_trend}
                  x="day"
                  series={[
                    { key: "opened", label: "Opened", color: "var(--chart-1)" },
                    { key: "resolved", label: "Resolved", color: "var(--chart-2)" },
                  ]}
                  formatX={(d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Open issues by priority</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <BreakdownBars
                  rows={["critical", "high", "medium", "low"].map((p) => ({ label: humanize(p), value: data.open_by_priority[p] ?? 0 }))}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
