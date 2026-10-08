"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars, ColumnChart } from "@/components/shared/charts";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { bucketLabel, Empty, RANGES } from "@/app/(app)/analytics/analytics-view";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

interface Platform {
  range: { days: number; bucket: string };
  organisations: number; organisations_suspended: number; workspaces: number;
  users: number; new_users: number; active_7d: number; active_30d: number;
  pending_invites: number; feedback_open: number;
  licences: Record<string, number>;
  feedback: Record<string, number>; // "kind:status" -> count
  series: { t: string; signups: number; organisations: number; workspaces: number }[];
  top_organisations: { id: string; name: string; kind: string; members: number; activity: number }[];
}

const MODULE_ORDER = ["facility", "expense", "tasks", "po"];

export function PlatformAnalytics() {
  const { t, locale } = useT();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({ queryKey: ["platform-analytics", days], queryFn: () => api<Platform>(`/admin/analytics?days=${days}`) });
  const feedbackByStatus = data
    ? Object.entries(data.feedback).reduce<Record<string, number>>((acc, [k, n]) => {
        const status = k.split(":")[1];
        acc[status] = (acc[status] ?? 0) + Number(n);
        return acc;
      }, {})
    : {};
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("platform.title")}
        description={t("platform.description")}
        actions={
          <NativeSelect className="w-36" aria-label={t("analytics.range")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((d) => <option key={d} value={d}>{t("analytics.lastDays", { n: d })}</option>)}
          </NativeSelect>
        }
      />
      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("platform.organisations")} value={data.organisations} hint={data.organisations_suspended ? t("platform.suspended", { n: data.organisations_suspended }) : t("platform.pendingInvites", { n: data.pending_invites })} href="/admin" />
            <Stat label={t("platform.workspaces")} value={data.workspaces} />
            <Stat label={t("platform.users")} value={data.users} hint={t("platform.newUsers", { n: data.new_users })} />
            <Stat label={t("platform.active")} value={data.active_7d} hint={t("platform.active30", { n: data.active_30d })} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>{t("platform.growth")}</CardTitle></CardHeader>
              <CardContent>
                <ColumnChart
                  data={data.series}
                  x="t"
                  formatX={(v) => bucketLabel(v, data.range.bucket, locale)}
                  series={[
                    { key: "signups", label: t("platform.signups"), color: "var(--chart-1)" },
                    { key: "organisations", label: t("platform.organisations"), color: "var(--chart-2)" },
                    { key: "workspaces", label: t("platform.workspaces"), color: "var(--chart-3)" },
                  ]}
                  ariaLabel={t("platform.growth")}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("platform.licences")}</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(data.licences).length
                  ? <BreakdownBars rows={MODULE_ORDER.filter((m) => data.licences[m] !== undefined).map((m) => ({ label: t(`modules.${m}`), value: Number(data.licences[m]) }))} />
                  : <Empty />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("platform.topOrgs")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t("platform.organisations")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("platform.members")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("platform.activity")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.top_organisations.map((o) => (
                      <tr key={o.id}>
                        <td className="max-w-[14rem] truncate px-4 py-2 font-medium">{o.name}{o.kind === "personal" && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t("platform.workspaces")})</span>}</td>
                        <td className="px-4 py-2 text-right tabular">{o.members}</td>
                        <td className="px-4 py-2 text-right tabular">{o.activity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("platform.feedbackByStatus")}</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(feedbackByStatus).length
                  ? <BreakdownBars rows={Object.entries(feedbackByStatus).map(([s, n]) => ({ label: t(`status.${s}`, undefined, s), value: n }))} />
                  : <Empty />}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
