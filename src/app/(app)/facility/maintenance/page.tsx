import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { MaintenanceTabs } from "./maintenance-tabs";

export const metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <div>
      <PageHeader title="Maintenance" description="Preventive maintenance schedules, AMC contracts and the statutory compliance calendar." />
      <Suspense>
        <MaintenanceTabs />
      </Suspense>
    </div>
  );
}
