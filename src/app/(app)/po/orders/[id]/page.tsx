import { OrderDetail } from "./order-detail";

export const metadata = { title: "Purchase order" };

export default async function OrderPage(props: PageProps<"/po/orders/[id]">) {
  const { id } = await props.params;
  return <OrderDetail id={id} />;
}
