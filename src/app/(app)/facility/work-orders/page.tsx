import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { WorkOrdersTable } from "./work-orders-table";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.workOrders.title") };
}

export default async function WorkOrdersPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader title={t("facility.workOrders.title")} description={t("facility.workOrders.description")} />
      <Suspense>
        <WorkOrdersTable />
      </Suspense>
    </div>
  );
}
