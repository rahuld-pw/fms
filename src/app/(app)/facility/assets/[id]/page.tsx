import { AssetDetail } from "./asset-detail";

export const metadata = { title: "Asset" };

export default async function AssetPage(props: PageProps<"/facility/assets/[id]">) {
  const { id } = await props.params;
  return <AssetDetail id={id} />;
}
