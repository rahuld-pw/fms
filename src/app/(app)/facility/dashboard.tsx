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
import { useT } from "@/lib/i18n/client";

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
  const { t } = useT();
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
            <Stat label={t("facility.dashboard.openIssues")} value={open} href="/facility/issues?status=open,acknowledged,assigned,in_progress,on_hold,reopened" />
            <Stat label={t("facility.dashboard.slaBreached")} value={data.sla_breached} tone={data.sla_breached ? "danger" : "good"} href="/facility/issues?escalation_level=2" />
            <Stat label={t("facility.dashboard.slaMet")} value={data.sla_met_pct_30d === null ? "—" : `${data.sla_met_pct_30d}%`} hint={data.avg_resolution_hours_30d ? t("facility.dashboard.avgResolve", { h: data.avg_resolution_hours_30d }) : undefined} />
            <Stat label={t("facility.dashboard.rating")} value={data.avg_rating_90d ? `${data.avg_rating_90d} / 5` : "—"} />
            <Stat label={t("facility.dashboard.openWorkOrders")} value={data.work_orders_open} hint={t("facility.dashboard.overdue", { n: data.work_orders_overdue })} tone={data.work_orders_overdue ? "warning" : "default"} href="/facility/work-orders" />
            <Stat label={t("facility.dashboard.pmOnTime")} value={data.pm_completion_pct_90d === null ? "—" : `${data.pm_completion_pct_90d}%`} href="/facility/maintenance" />
            <Stat label={t("facility.dashboard.complianceDue")} value={data.compliance_due_30d} hint={t("facility.dashboard.overdue", { n: data.compliance_overdue })} tone={data.compliance_overdue ? "danger" : "default"} href="/facility/maintenance?tab=compliance" />
            <Stat label={t("facility.dashboard.assetsInUse")} value={data.assets_by_status.in_use ?? 0} hint={t("facility.dashboard.underRepair", { n: data.assets_by_status.under_repair ?? 0 })} href="/facility/assets" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>{t("facility.dashboard.trendTitle")}</CardTitle>
                  <CardDescription>{t("facility.dashboard.last30")}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ColumnChart
                  ariaLabel={t("facility.dashboard.trendAria")}
                  data={data.issues_trend}
                  x="day"
                  series={[
                    { key: "opened", label: t("facility.dashboard.opened"), color: "var(--chart-1)" },
                    { key: "resolved", label: t("facility.dashboard.resolved"), color: "var(--chart-2)" },
                  ]}
                  formatX={(d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t("facility.dashboard.byPriority")}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <BreakdownBars
                  rows={["critical", "high", "medium", "low"].map((p) => ({ label: t(`priority.${p}`), value: data.open_by_priority[p] ?? 0 }))}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
