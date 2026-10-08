"use client";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackForm, type FeedbackKind } from "@/components/shared/feedback-form";
import { useT } from "@/lib/i18n/client";

export function PublicFeedback() {
  const { t } = useT();
  const kind = (useSearchParams().get("type") as FeedbackKind | null) ?? "bug";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("public.feedback.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("public.feedback.intro")}</p>
      </div>
      <Card><CardContent className="pt-4"><FeedbackForm initialKind={["bug", "feature", "other"].includes(kind) ? kind : "bug"} anonymous /></CardContent></Card>
    </div>
  );
}
