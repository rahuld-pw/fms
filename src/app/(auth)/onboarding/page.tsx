import { redirect } from "next/navigation";
import { getSessionContext, getSessionUser } from "@/lib/auth/context";
import { isPlatformAdmin } from "@/lib/auth/session-data";
import { createUserClient } from "@/lib/supabase/server";
import { WorkspaceChoice } from "./workspace-choice";

export const metadata = { title: "Welcome" };

/**
 * First stop after sign-up for users without an organisation. Organisations are
 * created by the platform administrator; everyone else gets a personal Tasks
 * workspace, unless they have an invitation waiting (then they choose).
 */
export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding");
  if (await getSessionContext()) redirect("/");
  if (await isPlatformAdmin()) redirect("/admin");
  const db = await createUserClient();
  const { data: invites } = await db.rpc("my_pending_invitations");
  if (invites?.length) return <WorkspaceChoice invites={invites} />;
  const { error } = await db.rpc("create_personal_workspace");
  if (error) throw new Error(error.message);
  redirect("/tasks");
}
