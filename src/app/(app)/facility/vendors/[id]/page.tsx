import { VendorDetail } from "./vendor-detail";

export const metadata = { title: "Vendor" };

export default async function VendorPage(props: PageProps<"/facility/vendors/[id]">) {
  const { id } = await props.params;
  return <VendorDetail id={id} />;
}
