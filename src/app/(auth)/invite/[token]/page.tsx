import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/context";
import { createUserClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-lg font-semibold">You&apos;ve been invited</h1>
        <p className="text-sm text-muted-foreground">Sign in (or create an account) with the email address the invitation was sent to.</p>
        <Button asChild>
          <Link href={`/login?next=/invite/${token}`}>Sign in to accept</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/signup`}>Create an account</Link>
        </Button>
      </div>
    );
  }
  const db = await createUserClient();
  const { error } = await db.rpc("accept_invitation", { p_token: token });
  if (!error) redirect("/");
  return (
    <div className="flex flex-col gap-3 text-center">
      <h1 className="text-lg font-semibold">Invitation problem</h1>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button variant="outline" asChild>
        <Link href="/">Go to the app</Link>
      </Button>
    </div>
  );
}
