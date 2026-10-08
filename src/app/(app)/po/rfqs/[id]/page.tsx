import { getT } from "@/lib/i18n/server";
import { RfqDetail } from "./rfq-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("po.meta.rfq") };
}

export default async function RfqPage(props: PageProps<"/po/rfqs/[id]">) {
  const { id } = await props.params;
  return <RfqDetail id={id} />;
}
