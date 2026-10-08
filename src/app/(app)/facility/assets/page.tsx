import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { AssetsTable } from "./assets-table";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.assets.title") };
}

export default async function AssetsPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader title={t("facility.assets.title")} description={t("facility.assets.description")} />
      <Suspense>
        <AssetsTable />
      </Suspense>
    </div>
  );
}
