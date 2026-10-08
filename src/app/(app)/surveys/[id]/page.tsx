import { getT } from "@/lib/i18n/server";
import { SurveyResults } from "./survey-results";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("surveys.results.metaTitle") };
}

export default async function SurveyPage(props: PageProps<"/surveys/[id]">) {
  const { id } = await props.params;
  return (
    <div className="mx-auto max-w-6xl">
      <SurveyResults id={id} />
    </div>
  );
}
