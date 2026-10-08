import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { ResolutionFeedback } from "./resolution-feedback";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("surveys.resolution.title") };
}

export default async function ResolutionFeedbackPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("surveys.resolution.title")} description={t("surveys.resolution.description")} />
      <ResolutionFeedback />
    </div>
  );
}
