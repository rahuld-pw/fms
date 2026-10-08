import { getT } from "@/lib/i18n/server";
import { RequisitionDetail } from "./requisition-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("po.meta.requisition") };
}

export default async function RequisitionPage(props: PageProps<"/po/requisitions/[id]">) {
  const { id } = await props.params;
  return <RequisitionDetail id={id} />;
}
