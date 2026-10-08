"use client";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";

/**
 * A plain `<form method="post">` (e.g. sign-out) whose submit button disables
 * itself and shows a spinner once submitted, so it can't be posted twice.
 */
export function PostFormButton({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const [pending, setPending] = useState(false);
  return (
    <form
      action={action}
      method="post"
      onSubmit={(e) => {
        if (pending) return e.preventDefault();
        setPending(true);
      }}
    >
      <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined}>
        {pending && <Spinner />}
        {children}
      </button>
    </form>
  );
}
