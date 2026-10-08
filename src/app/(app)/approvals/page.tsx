import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { ApprovalsView } from "./approvals-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("approvals.page.title") };
}

export default async function ApprovalsPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("approvals.page.title")} description={t("approvals.page.description")} />
      <ApprovalsView />
    </div>
  );
}
