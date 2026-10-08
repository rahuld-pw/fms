import { getT } from "@/lib/i18n/server";
import { WorkOrderDetail } from "./work-order-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.workOrders.detail.metaTitle") };
}

export default async function WorkOrderPage(props: PageProps<"/facility/work-orders/[id]">) {
  const { id } = await props.params;
  return <WorkOrderDetail id={id} />;
}
