import { RfqDetail } from "./rfq-detail";

export const metadata = { title: "RFQ" };

export default async function RfqPage(props: PageProps<"/po/rfqs/[id]">) {
  const { id } = await props.params;
  return <RfqDetail id={id} />;
}
