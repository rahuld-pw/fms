import { Suspense } from "react";
import { PublicFeedback } from "./public-feedback";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("public.feedback.metaTitle") };
}

export default function FeedbackPage() {
  return (
    <Suspense>
      <PublicFeedback />
    </Suspense>
  );
}
