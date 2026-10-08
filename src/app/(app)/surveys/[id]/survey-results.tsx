"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Copy, Pencil, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ColumnChart } from "@/components/shared/charts";
import { DateTime } from "@/components/shared/format";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { NpsValue } from "@/components/shared/score-picker";
import { StatusBadge } from "@/components/shared/status";
import { bucketLabel } from "@/app/(app)/analytics/analytics-view";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SurveyDialog, type SurveyForm } from "../survey-dialog";

type Group = "promoter" | "passive" | "detractor";
interface Results {
  survey: SurveyForm & { id: string; created_at: string; public_token: string | null };
  link: string | null;
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  average: number | null;
  satisfied_pct: number | null;
  distribution: { score: number; count: number }[];
  trend: { t: string; responses: number; nps: number | null }[];
  segments: { segment: string; responses: number; nps: number | null; average: number | null }[];
  comments: { id: string; score: number; group: Group; comment: string; segment: string | null; created_at: string; name: string | null; email: string | null }[];
}

// Diverging encoding: promoters blue, passives neutral grey, detractors red;
// every segment is also labelled with its count and share.
const GROUP_COLOR: Record<Group, string> = { promoter: "var(--chart-1)", passive: "var(--chart-track-strong, #b5b4ae)", detractor: "#e34948" };

export function SurveyResults({ id }: { id: string }) {
  const { t, locale } = useT();
  const can = useCan();
  const manage = can("survey:manage", {}, "strict");
  const qc = useQueryClient();
  const [days, setDays] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<Group | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["survey", id, days],
    queryFn: () => api<Results>(`/surveys/${id}/results${days ? `?days=${days}` : ""}`),
  });
  if (isLoading || !data) return <div className="flex flex-col gap-3"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const s = data.survey;
  const nps = s.kind === "nps";
  const total = Number(data.responses);
  const setStatus = async (status: "active" | "closed") => {
    try {
      await api(`/surveys/${id}`, { method: "PATCH", body: { status } });
      toast.success(status === "active" ? t("surveys.results.opened") : t("surveys.results.closed"));
      qc.invalidateQueries({ queryKey: ["survey", id] });
      qc.invalidateQueries({ queryKey: ["surveys"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const groups: Group[] = ["promoter", "passive", "detractor"];
  const counts: Record<Group, number> = { promoter: Number(data.promoters), passive: Number(data.passives), detractor: Number(data.detractors) };
  const comments = data.comments.filter((c) => filter === "all" || c.group === filter);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/surveys" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t("surveys.list.title")}</Link>
      <PageHeader
        title={s.title}
        description={s.question}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {t("ui.edit")}</Button>}
            {manage && s.status !== "active" && <Button onClick={() => setStatus("active")}>{t("surveys.results.open")}</Button>}
            {manage && s.status === "active" && <Button variant="outline" onClick={() => setStatus("closed")}>{t("surveys.results.close")}</Button>}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} />
        <Badge tone="blue">{t(`enum.surveyKind.${s.kind}`)}</Badge>
        <Badge>{t(`enum.surveyAudience.${s.audience}`)}</Badge>
        {s.anonymous && <Badge tone="violet">{t("surveys.anonymous")}</Badge>}
        {s.closes_at && <span className="text-xs text-muted-foreground">{t("surveys.results.closesOn")} <DateTime value={s.closes_at} dateOnly /></span>}
        <NativeSelect className="ml-auto w-40" aria-label={t("analytics.range")} value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">{t("surveys.results.allTime")}</option>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{t("analytics.lastDays", { n: d })}</option>)}
        </NativeSelect>
      </div>

      {manage && data.link && s.audience !== "members" && <ShareCard id={id} link={data.link} active={s.status === "active"} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={nps ? t("surveys.nps") : t("surveys.average")} value={<NpsValue value={nps ? data.nps : data.average} kind={s.kind} />} hint={nps ? t("surveys.results.npsHint") : undefined} />
        <Stat label={t("surveys.results.responses")} value={total} />
        <Stat label={nps ? t("surveys.results.promoters") : t("surveys.results.satisfied")} value={total ? `${Math.round((counts.promoter / total) * 100)}%` : "—"} hint={t("surveys.results.ofN", { n: counts.promoter, total })} />
        <Stat label={nps ? t("surveys.results.detractors") : t("surveys.results.unhappy")} value={total ? `${Math.round((counts.detractor / total) * 100)}%` : "—"} hint={t("surveys.results.ofN", { n: counts.detractor, total })} tone={total && counts.detractor / total > 0.3 ? "warning" : "default"} />
      </div>

      {total === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("surveys.results.noResponses")}</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("surveys.results.split")}</CardTitle>
              <CardDescription>{nps ? t("surveys.results.splitNps") : t("surveys.results.splitCsat")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={groups.map((g) => `${t(`surveys.group.${s.kind}.${g}`)} ${counts[g]}`).join(", ")}>
                {groups.filter((g) => counts[g] > 0).map((g) => (
                  <div key={g} style={{ flex: counts[g], background: GROUP_COLOR[g] }} className="h-full first:rounded-l last:rounded-r" />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {groups.map((g) => (
                  <li key={g} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: GROUP_COLOR[g] }} />
                    <span className="text-muted-foreground">{t(`surveys.group.${s.kind}.${g}`)}</span>
                    <span className="font-medium tabular">{counts[g]} · {Math.round((counts[g] / total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>{t("surveys.results.distribution")}</CardTitle></CardHeader>
              <CardContent>
                <ColumnChart data={data.distribution.map((d) => ({ score: String(d.score), count: Number(d.count) }))} x="score"
                  series={[{ key: "count", label: t("surveys.results.responses"), color: "var(--chart-1)" }]} ariaLabel={t("surveys.results.distribution")} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("surveys.results.trend")}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ColumnChart data={data.trend.map((w) => ({ t: w.t, responses: Number(w.responses) }))} x="t" formatX={(v) => bucketLabel(v, "week", locale)}
                  series={[{ key: "responses", label: t("surveys.results.responses"), color: "var(--chart-1)" }]} ariaLabel={t("surveys.results.trend")} />
                {nps && data.trend.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t("surveys.results.npsByWeek")}</span>
                    {data.trend.slice(-8).map((w) => (
                      <span key={w.t} className="rounded border px-1.5 py-0.5 tabular">{bucketLabel(w.t, "week", locale)}: <b>{w.nps === null ? "—" : w.nps > 0 ? `+${w.nps}` : w.nps}</b></span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {data.segments.length > 1 && (
            <Card>
              <CardHeader><CardTitle>{t("surveys.results.segments")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr><th className="px-4 py-2 font-medium">{t("surveys.results.segment")}</th><th className="px-4 py-2 text-right font-medium">{t("surveys.results.responses")}</th><th className="px-4 py-2 text-right font-medium">{nps ? t("surveys.nps") : t("surveys.average")}</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.segments.map((g) => (
                      <tr key={g.segment}>
                        <td className="px-4 py-2">{t(`enum.surveySegment.${g.segment}`)}</td>
                        <td className="px-4 py-2 text-right tabular">{g.responses}</td>
                        <td className="px-4 py-2 text-right"><NpsValue value={nps ? g.nps : g.average} kind={s.kind} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{t("surveys.results.comments")}</CardTitle>
              <div className="flex flex-wrap gap-1">
                {(["all", ...groups] as const).map((g) => (
                  <Button key={g} size="xs" variant={filter === g ? "secondary" : "ghost"} onClick={() => setFilter(g)}>
                    {g === "all" ? t("ui.all") : t(`surveys.group.${s.kind}.${g}`)}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {comments.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("surveys.results.noComments")}</p>}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3 py-3">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular text-white")} style={{ background: GROUP_COLOR[c.group], color: c.group === "passive" ? "var(--foreground)" : undefined }}>
                    {c.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words whitespace-pre-line">{c.comment}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[c.name ?? (s.anonymous ? t("surveys.anonymous") : null), c.segment ? t(`enum.surveySegment.${c.segment}`) : null].filter(Boolean).join(" · ")}
                      {" · "}<DateTime value={c.created_at} relative />
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      {manage && editing && <SurveyDialog open={editing} onOpenChange={setEditing} survey={{ ...s, closes_at: s.closes_at }} />}
    </div>
  );
}

function ShareCard({ id, link, active }: { id: string; link: string; active: boolean }) {
  const { t } = useT();
  const [qr, setQr] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("surveys.share.title")}</CardTitle>
        <CardDescription>{active ? t("surveys.share.description") : t("surveys.share.notOpen")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{link}</code>
          <div className="flex gap-2">
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(link); toast.success(t("ui.copied")); }}><Copy /> {t("ui.copyLink")}</Button>
            <Button variant="outline" onClick={() => setQr((q) => !q)}><QrCode /> {t("surveys.share.qr")}</Button>
          </div>
        </div>
        {qr && (
          <div className="flex flex-col items-center gap-2 sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/surveys/${id}/qr.svg`} alt={t("surveys.share.qrAlt")} className="size-48 rounded-md border bg-white p-2" />
            <span className="text-xs text-muted-foreground">{t("surveys.share.qrHint")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
