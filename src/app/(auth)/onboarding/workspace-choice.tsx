"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function WorkspaceChoice({ invites }: { invites: { org_name: string; expires_at: string }[] }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const personal = async () => {
    if (busy) return;
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
        <h1 className="text-lg font-semibold">{t("onboarding.invitationTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.invitationBody")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {invites.map((i) => (
          <li key={i.org_name} className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <MailOpen className="size-4 text-primary" /> <span className="font-medium">{i.org_name}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("onboarding.cantFind")}</p>
      <Button variant="outline" loading={busy} onClick={personal}>{t("onboarding.continuePersonal")}</Button>
    </div>
  );
}
