import { Suspense } from "react";
import { AuditLog } from "./audit-log";

export const metadata = { title: "Audit log" };

export default function AuditPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
