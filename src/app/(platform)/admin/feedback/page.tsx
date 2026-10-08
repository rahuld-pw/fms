import { FeedbackTriage } from "./feedback-triage";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.feedback.title") };
}

export default function AdminFeedbackPage() {
  return <FeedbackTriage />;
}
