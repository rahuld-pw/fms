import { getT } from "@/lib/i18n/server";
import { PublicSurvey } from "./public-survey";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("surveys.public.metaTitle"), robots: { index: false } };
}

export default async function PublicSurveyPage(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  return <PublicSurvey token={token} />;
}
