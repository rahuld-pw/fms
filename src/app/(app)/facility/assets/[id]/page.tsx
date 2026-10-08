import { getT } from "@/lib/i18n/server";
import { AssetDetail } from "./asset-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.assets.detail.metaTitle") };
}

export default async function AssetPage(props: PageProps<"/facility/assets/[id]">) {
  const { id } = await props.params;
  return <AssetDetail id={id} />;
}
