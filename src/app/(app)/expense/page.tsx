import { PageHeader } from "@/components/shared/page-header";
import { ExpenseDashboard } from "./dashboard";

export const metadata = { title: "Expenses" };

export default function ExpensePage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Budget overview" description="Budget vs committed (open POs) vs actual spend." />
      <ExpenseDashboard />
    </div>
  );
}
