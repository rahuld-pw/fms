import { getT } from "@/lib/i18n/server";
import { IssueDetail } from "./issue-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.issues.detail.metaTitle") };
}

export default async function IssuePage(props: PageProps<"/facility/issues/[id]">) {
  const { id } = await props.params;
  return <IssueDetail id={id} />;
}
