import { Suspense } from "react";
import { IssueStatus } from "./issue-status";

export const metadata = { title: "Track an issue", robots: { index: false } };

export default function StatusPage() {
  return (
    <Suspense>
      <IssueStatus />
    </Suspense>
  );
}
