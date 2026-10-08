import { Suspense } from "react";
import { getT } from "@/lib/i18n/server";
import { AuditLog } from "./audit-log";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/audit") };
}

export default function AuditPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
