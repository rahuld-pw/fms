import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth/session-data";
import { getT } from "@/lib/i18n/server";
import { AnalyticsView } from "./analytics-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("analytics.title") };
}

export default async function AnalyticsPage() {
  await requireSession();
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("analytics.title")} description={t("analytics.description")} />
      <AnalyticsView />
    </div>
  );
}
