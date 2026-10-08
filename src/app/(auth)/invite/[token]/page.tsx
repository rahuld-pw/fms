import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/context";
import { createUserClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("invite.pageTitle") };
}

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const { t } = await getT();
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-lg font-semibold">{t("invite.invitedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("invite.invitedBody")}</p>
        <Button asChild>
          <Link href={`/login?next=/invite/${token}`}>{t("invite.signInToAccept")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/signup?next=/invite/${token}`}>{t("invite.createAccount")}</Link>
        </Button>
      </div>
    );
  }
  const db = await createUserClient();
  const { error } = await db.rpc("accept_invitation", { p_token: token });
  if (!error) redirect("/");
  return (
    <div className="flex flex-col gap-3 text-center">
      <h1 className="text-lg font-semibold">{t("invite.problemTitle")}</h1>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button variant="outline" asChild>
        <Link href="/">{t("invite.goToApp")}</Link>
      </Button>
    </div>
  );
}
