import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { NewIssueForm } from "./new-issue-form";

export const metadata = { title: "Report an issue" };

export default function NewIssuePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Report an issue" breadcrumbs={[{ label: "Issues", href: "/facility/issues" }, { label: "New" }]} />
      <Suspense>
        <NewIssueForm />
      </Suspense>
    </div>
  );
}
