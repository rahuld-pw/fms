import { getT } from "@/lib/i18n/server";
import { OrderDetail } from "./order-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("po.meta.purchaseOrder") };
}

export default async function OrderPage(props: PageProps<"/po/orders/[id]">) {
  const { id } = await props.params;
  return <OrderDetail id={id} />;
}
