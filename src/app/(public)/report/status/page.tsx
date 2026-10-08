import { Suspense } from "react";
import { IssueStatus } from "./issue-status";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("public.status.metaTitle"), robots: { index: false } };
}

export default function StatusPage() {
  return (
    <Suspense>
      <IssueStatus />
    </Suspense>
  );
}
