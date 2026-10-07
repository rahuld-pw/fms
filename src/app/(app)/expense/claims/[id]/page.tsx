import { ClaimDetail } from "./claim-detail";

export const metadata = { title: "Expense claim" };

export default async function ClaimPage(props: PageProps<"/expense/claims/[id]">) {
  const { id } = await props.params;
  return <ClaimDetail id={id} />;
}
