import { getT } from "@/lib/i18n/server";
import { ClaimDetail } from "./claim-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("expense.claims.metaTitle") };
}

export default async function ClaimPage(props: PageProps<"/expense/claims/[id]">) {
  const { id } = await props.params;
  return <ClaimDetail id={id} />;
}
