import { WorkOrderDetail } from "./work-order-detail";

export const metadata = { title: "Work order" };

export default async function WorkOrderPage(props: PageProps<"/facility/work-orders/[id]">) {
  const { id } = await props.params;
  return <WorkOrderDetail id={id} />;
}
