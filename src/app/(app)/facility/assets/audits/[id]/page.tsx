import { AuditDetail } from "./audit-detail";

export default async function AuditPage(props: PageProps<"/facility/assets/audits/[id]">) {
  const { id } = await props.params;
  return <AuditDetail id={id} />;
}
