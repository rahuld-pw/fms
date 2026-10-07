import { PageHeader } from "@/components/shared/page-header";
import { FacilityDashboard } from "./dashboard";

export const metadata = { title: "Facilities" };

export default function FacilityPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Facilities overview" description="Issues, SLAs, maintenance and compliance across campuses." />
      <FacilityDashboard />
    </div>
  );
}
