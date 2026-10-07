import { RequisitionDetail } from "./requisition-detail";

export const metadata = { title: "Requisition" };

export default async function RequisitionPage(props: PageProps<"/po/requisitions/[id]">) {
  const { id } = await props.params;
  return <RequisitionDetail id={id} />;
}
