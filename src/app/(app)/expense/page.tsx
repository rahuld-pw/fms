import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { ExpenseDashboard } from "./dashboard";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("expense.overview.metaTitle") };
}

export default async function ExpensePage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("expense.overview.title")} description={t("expense.overview.description")} />
      <ExpenseDashboard />
    </div>
  );
}
