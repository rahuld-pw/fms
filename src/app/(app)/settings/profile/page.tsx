import { getT } from "@/lib/i18n/server";
import { ProfileSettings } from "./profile-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/profile") };
}

export default function ProfilePage() {
  return <ProfileSettings />;
}
