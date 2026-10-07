import { IssueDetail } from "./issue-detail";

export const metadata = { title: "Issue" };

export default async function IssuePage(props: PageProps<"/facility/issues/[id]">) {
  const { id } = await props.params;
  return <IssueDetail id={id} />;
}
