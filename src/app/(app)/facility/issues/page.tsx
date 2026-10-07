import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { IssuesTable } from "./issues-table";

export const metadata = { title: "Issues" };

export default function IssuesPage() {
  return (
    <div>
      <PageHeader
        title="Issues"
        description="Reported problems across campuses, with SLA tracking."
        actions={
          <Button asChild>
            <Link href="/facility/issues/new">
              <Plus /> Report issue
            </Link>
          </Button>
        }
      />
      <Suspense>
        <IssuesTable />
      </Suspense>
    </div>
  );
}
