import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { IssuesTable } from "./issues-table";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.issues.title") };
}

export default async function IssuesPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader
        title={t("facility.issues.title")}
        description={t("facility.issues.description")}
        actions={
          <Button asChild>
            <Link href="/facility/issues/new">
              <Plus /> {t("facility.issues.report")}
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
