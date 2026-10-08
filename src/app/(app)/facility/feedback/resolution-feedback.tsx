"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/app/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars } from "@/components/shared/charts";
import { CampusSelect } from "@/components/shared/fields";
import { DateTime } from "@/components/shared/format";
import { Stat } from "@/components/shared/page-header";
import { RANGES } from "@/app/(app)/analytics/analytics-view";
import { Stars } from "@/components/shared/score-picker";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

interface Feedback {
  resolved: number;
  rated: number;
  average: number | null;
  satisfied_pct: number | null;
  reopened: number;
  distribution: { score: number; count: number }[];
  resolvers: { user_id: string; name: string | null; resolved: number; rated: number; average: number | null; reopened: number }[];
  comments: { issue_id: string; number: string; title: string; rating: number; feedback: string | null; at: string | null; resolver: string | null }[];
}


export function ResolutionFeedback() {
  const { t } = useT();
  const { campuses } = useSession();
  const [days, setDays] = useState(90);
  const [campus, setCampus] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["resolution-feedback", days, campus],
    queryFn: () => api<Feedback>(`/feedback/resolution?days=${days}${campus ? `&campus_id=${campus}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-full flex-wrap justify-end gap-2">
        {campuses.length > 1 && <div className="min-w-0 flex-1 sm:w-48 sm:flex-none"><CampusSelect value={campus} onChange={setCampus} allowEmpty /></div>}
        <NativeSelect className="min-w-0 flex-1 sm:w-44 sm:flex-none" aria-label={t("analytics.range")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((d) => <option key={d} value={d}>{t("analytics.lastDays", { n: d })}</option>)}
        </NativeSelect>
      </div>
      {isLoading || !data ? <Skeleton className="h-64" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("surveys.resolution.average")} value={<Stars value={data.average} />} hint={t("surveys.resolution.ratedOf", { n: data.rated, total: data.resolved })} />
            <Stat label={t("surveys.resolution.satisfied")} value={data.satisfied_pct === null ? "—" : `${data.satisfied_pct}%`} hint={t("surveys.resolution.satisfiedHint")} />
            <Stat label={t("surveys.resolution.resolved")} value={data.resolved} />
            <Stat label={t("surveys.resolution.reopened")} value={data.reopened} tone={data.reopened ? "warning" : "default"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>{t("surveys.resolution.byPerson")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {data.resolvers.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("analytics.empty")}</p> : (
                  <table className="w-full min-w-[22rem] text-sm">
                    <thead className="border-b text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t("analytics.team.person")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("surveys.resolution.resolved")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("surveys.resolution.rated")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("surveys.resolution.rating")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.resolvers.map((r) => (
                        <tr key={r.user_id}>
                          <td className="px-4 py-2 font-medium">{r.name ?? "—"}</td>
                          <td className="px-4 py-2 text-right tabular">{r.resolved}</td>
                          <td className="px-4 py-2 text-right tabular">{r.rated}</td>
                          <td className="px-4 py-2 text-right"><Stars value={r.average} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("surveys.resolution.distribution")}</CardTitle></CardHeader>
              <CardContent>
                <BreakdownBars rows={[...data.distribution].reverse().map((d) => ({ label: "★".repeat(d.score), value: Number(d.count) }))} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>{t("surveys.resolution.comments")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col divide-y">
              {data.comments.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("surveys.resolution.noComments")}</p>}
              {data.comments.map((c) => (
                <Link key={c.issue_id} href={`/facility/issues/${c.issue_id}`} className="flex gap-3 py-3 hover:bg-muted/40">
                  <span className="w-16 shrink-0 text-amber-500" aria-label={t("surveys.resolution.starsOf", { v: c.rating })}>{"★".repeat(c.rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - c.rating)}</span></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.number} · {c.title}</p>
                    {c.feedback && <p className="text-sm break-words text-muted-foreground">“{c.feedback}”</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.resolver ? t("surveys.resolution.resolvedByName", { name: c.resolver }) : null}
                      {c.at && <> · <DateTime value={c.at} relative /></>}
                    </p>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
