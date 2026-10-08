import { getT } from "@/lib/i18n/server";
import { VendorDetail } from "./vendor-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.vendors.detail.metaTitle") };
}

export default async function VendorPage(props: PageProps<"/facility/vendors/[id]">) {
  const { id } = await props.params;
  return <VendorDetail id={id} />;
}
