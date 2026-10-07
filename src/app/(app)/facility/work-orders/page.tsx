import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { WorkOrdersTable } from "./work-orders-table";

export const metadata = { title: "Work orders" };

export default function WorkOrdersPage() {
  return (
    <div>
      <PageHeader title="Work orders" description="Corrective, preventive and compliance jobs for staff and vendors." />
      <Suspense>
        <WorkOrdersTable />
      </Suspense>
    </div>
  );
}
