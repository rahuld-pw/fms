import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { SurveyList } from "./survey-list";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("surveys.list.title") };
}

export default async function SurveysPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("surveys.list.title")} description={t("surveys.list.description")} />
      <SurveyList />
    </div>
  );
}
