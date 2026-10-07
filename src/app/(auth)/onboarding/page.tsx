import { redirect } from "next/navigation";
import { getSessionContext, getSessionUser } from "@/lib/auth/context";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Set up your organisation" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding");
  if (await getSessionContext()) redirect("/");
  return <OnboardingForm />;
}
