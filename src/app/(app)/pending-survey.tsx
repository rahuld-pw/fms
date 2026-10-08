"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MessageSquareHeart, X } from "lucide-react";
import { toast } from "sonner";
import { useModule } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { ScorePicker } from "@/components/shared/score-picker";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

interface Pending { id: string; title: string; description: string | null; kind: "nps" | "csat"; question: string; follow_up: string | null; anonymous: boolean }

/** One open survey at a time on Home, answered in place. */
export function PendingSurvey() {
  const { t } = useT();
  const enabled = useModule("surveys");
  const qc = useQueryClient();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const { data } = useQuery({ queryKey: ["surveys", "pending"], queryFn: () => api<Pending[]>("/surveys/pending"), enabled });
  const s = data?.find((x) => !skipped.includes(x.id));
  if (!enabled || !s) return null;
  const submit = async () => {
    if (score === null) return;
    try {
      await api(`/surveys/${s.id}/responses`, { body: { score, comment: comment || null } });
      toast.success(t("surveys.home.thanks"));
      setScore(null);
      setComment("");
      await qc.invalidateQueries({ queryKey: ["surveys", "pending"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card className="mt-4 border-primary/30">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-start gap-2">
          <MessageSquareHeart className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{s.title}{s.anonymous ? ` · ${t("surveys.anonymous")}` : ""}</p>
            <p className="font-medium break-words">{s.question}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t("surveys.home.later")} onClick={() => setSkipped((x) => [...x, s.id])}><X /></Button>
        </div>
        <ScorePicker kind={s.kind} value={score} onChange={setScore} />
        {score !== null && (
          <>
            <Textarea rows={2} maxLength={2000} placeholder={s.follow_up || t("surveys.form.followUpDefault")} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSkipped((x) => [...x, s.id])}>{t("surveys.home.later")}</Button>
              <Button onClick={submit}>{t("ui.submit")}</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
