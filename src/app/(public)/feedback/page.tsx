import { Suspense } from "react";
import { PublicFeedback } from "./public-feedback";

export const metadata = { title: "Report a bug or suggest a feature" };

export default function FeedbackPage() {
  return (
    <Suspense>
      <PublicFeedback />
    </Suspense>
  );
}
