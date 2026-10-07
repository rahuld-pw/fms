"use client";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackForm, type FeedbackKind } from "@/components/shared/feedback-form";

export function PublicFeedback() {
  const kind = (useSearchParams().get("type") as FeedbackKind | null) ?? "bug";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Help us improve Campus Ops</h1>
        <p className="text-sm text-muted-foreground">Report something that isn&apos;t working, or tell us what you&apos;d like to see next. Signed-in users can also do this from the account menu.</p>
      </div>
      <Card><CardContent className="pt-4"><FeedbackForm initialKind={["bug", "feature", "other"].includes(kind) ? kind : "bug"} anonymous /></CardContent></Card>
    </div>
  );
}
