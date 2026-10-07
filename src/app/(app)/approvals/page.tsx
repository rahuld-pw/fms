import { PageHeader } from "@/components/shared/page-header";
import { ApprovalsView } from "./approvals-view";

export const metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Approvals" description="Requests waiting for your decision, and the status of requests you raised." />
      <ApprovalsView />
    </div>
  );
}
