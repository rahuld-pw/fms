import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { AssetsTable } from "./assets-table";

export const metadata = { title: "Assets" };

export default function AssetsPage() {
  return (
    <div>
      <PageHeader title="Assets" description="Asset register with QR tags, lifecycle, warranty and depreciation." />
      <Suspense>
        <AssetsTable />
      </Suspense>
    </div>
  );
}
