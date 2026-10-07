"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function WorkspaceChoice({ invites }: { invites: { org_name: string; expires_at: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const personal = async () => {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("create_personal_workspace");
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    router.replace("/tasks");
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">You have an invitation</h1>
        <p className="text-sm text-muted-foreground">Open the invitation link from your email to join:</p>
      </div>
      <ul className="flex flex-col gap-2">
        {invites.map((i) => (
          <li key={i.org_name} className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <MailOpen className="size-4 text-primary" /> <span className="font-medium">{i.org_name}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Can&apos;t find the email? Ask your administrator to resend it from Settings → Users.</p>
      <Button variant="outline" loading={busy} onClick={personal}>Continue to my personal task workspace</Button>
    </div>
  );
}
