import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { TransfersTable } from "./transfers-table";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./facility/assets/transfers") };
}

export default async function TransfersPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader
        title={t("nav./facility/assets/transfers")}
        breadcrumbs={[{ label: t("facility.assets.title"), href: "/facility/assets" }, { label: t("facility.assets.detail.transfers") }]}
      />
      <Suspense>
        <TransfersTable />
      </Suspense>
    </div>
  );
}
