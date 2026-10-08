import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { FacilityDashboard } from "./dashboard";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.overview.metaTitle") };
}

export default async function FacilityPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("facility.overview.title")} description={t("facility.overview.description")} />
      <FacilityDashboard />
    </div>
  );
}
