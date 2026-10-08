"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { MessageSquareHeart, Plus } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { EmptyState } from "@/components/shared/page-header";
import { NpsValue } from "@/components/shared/score-picker";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { SurveyDialog } from "./survey-dialog";

export interface SurveyRow {
  id: string;
  title: string;
  kind: "nps" | "csat";
  audience: "members" | "public" | "both";
  status: "draft" | "active" | "closed";
  anonymous: boolean;
  campus_id: string | null;
  closes_at: string | null;
  created_at: string;
  responses: number;
  score: number | null;
  last_response_at: string | null;
}

export function SurveyList() {
  const { t } = useT();
  const can = useCan();
  const manage = can("survey:manage", {}, "strict");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["surveys"], queryFn: () => api<SurveyRow[]>("/surveys") });
  return (
    <div className="flex flex-col gap-4">
      {manage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}><Plus /> {t("surveys.list.new")}</Button>
        </div>
      )}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon={MessageSquareHeart} title={t("surveys.list.emptyTitle")} description={t("surveys.list.emptyDescription")}
          action={manage ? <Button onClick={() => setCreating(true)}><Plus /> {t("surveys.list.new")}</Button> : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <Link key={s.id} href={`/surveys/${s.id}`} className="min-w-0">
              <Card className="h-full transition-colors hover:border-foreground/20">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium break-words">{s.title}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="blue">{t(`enum.surveyKind.${s.kind}`)}</Badge>
                    <Badge>{t(`enum.surveyAudience.${s.audience}`)}</Badge>
                    {s.anonymous && <Badge tone="violet">{t("surveys.anonymous")}</Badge>}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{s.kind === "nps" ? t("surveys.nps") : t("surveys.average")}</div>
                      <NpsValue value={s.score} kind={s.kind} className="text-2xl font-semibold" />
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{t(Number(s.responses) === 1 ? "surveys.responsesOne" : "surveys.responsesOther", { n: s.responses })}</div>
                      {s.last_response_at && <DateTime value={s.last_response_at} relative />}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {manage && <SurveyDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}
