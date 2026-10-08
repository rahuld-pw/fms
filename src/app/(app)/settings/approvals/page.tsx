import { getT } from "@/lib/i18n/server";
import { ApprovalSettings } from "./approval-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/approvals") };
}

export default function ApprovalPoliciesPage() {
  return <ApprovalSettings />;
}
