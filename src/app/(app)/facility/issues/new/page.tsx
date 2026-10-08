import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { getT } from "@/lib/i18n/server";
import { NewIssueForm } from "./new-issue-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("facility.issues.new.title") };
}

export default async function NewIssuePage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("facility.issues.new.title")} breadcrumbs={[{ label: t("facility.issues.title"), href: "/facility/issues" }, { label: t("common.new") }]} />
      <Suspense>
        <NewIssueForm />
      </Suspense>
    </div>
  );
}
