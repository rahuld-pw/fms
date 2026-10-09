import { getT } from "@/lib/i18n/server";
import { MyFeedback } from "./my-feedback";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/feedback") };
}

export default function MyFeedbackPage() {
  return <MyFeedback />;
}
