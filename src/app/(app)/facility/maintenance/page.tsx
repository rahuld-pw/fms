import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { MaintenanceTabs } from "./maintenance-tabs";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.maintenance.title") };
}

export default async function MaintenancePage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader title={t("facility.maintenance.title")} description={t("facility.maintenance.description")} />
      <Suspense>
        <MaintenanceTabs />
      </Suspense>
    </div>
  );
}
