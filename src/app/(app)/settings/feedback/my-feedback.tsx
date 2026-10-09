"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bug, Lightbulb, MessageSquare, MessageSquareReply } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { FeedbackDialog, type FeedbackKind } from "@/components/shared/feedback-form";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

interface Report {
  id: string; kind: FeedbackKind; title: string; description: string; status: string; reply: string | null; created_at: string; updated_at: string;
}

const ICON = { bug: Bug, feature: Lightbulb, other: MessageSquare } as const;
const TONE: Record<string, "neutral" | "blue" | "amber" | "green" | "violet" | "red"> = {
  new: "blue", triaged: "violet", planned: "amber", in_progress: "amber", done: "green", wont_fix: "neutral", duplicate: "neutral",
};

/** The signed-in user's bug reports and feature requests, with status and the team's reply. */
export function MyFeedback() {
  const { t } = useT();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["feedback", "mine"], queryFn: () => api<Report[]>("/feedback/mine") });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("settings.feedback.title")}
        description={t("settings.feedback.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setKind("bug")}><Bug /> {t("account.reportBug")}</Button>
            <Button variant="outline" onClick={() => setKind("feature")}><Lightbulb /> {t("account.suggestFeature")}</Button>
          </div>
        }
      />
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !data?.length ? (
          <div className="p-4"><EmptyState title={t("settings.feedback.emptyTitle")} description={t("settings.feedback.emptyDescription")} /></div>
        ) : (
          <ul className="divide-y">
            {data.map((f) => {
              const Icon = ICON[f.kind] ?? MessageSquare;
              return (
                <li key={f.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex items-start gap-3">
                    <Icon className={f.kind === "bug" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-amber-600"} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`settings.feedback.kinds.${f.kind}`)} · {t("settings.feedback.sent")} <DateTime value={f.created_at} relative />
                        {f.updated_at !== f.created_at && <> · {t("settings.feedback.updated")} <DateTime value={f.updated_at} relative /></>}
                      </p>
                    </div>
                    <Badge tone={TONE[f.status]}>{t(`status.${f.status}`, undefined, humanize(f.status))}</Badge>
                  </div>
                  <p className="ml-7 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{f.description}</p>
                  {f.reply && (
                    <div className="ml-7 flex gap-2 rounded-md bg-muted p-3">
                      <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{t("settings.feedback.reply")}</p>
                        <p className="whitespace-pre-wrap">{f.reply}</p>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <FeedbackDialog open={!!kind} onOpenChange={(o) => !o && setKind(null)} kind={kind ?? "bug"} onSent={() => qc.invalidateQueries({ queryKey: ["feedback", "mine"] })} />
    </div>
  );
}
