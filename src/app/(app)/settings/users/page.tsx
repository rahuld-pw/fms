import { getT } from "@/lib/i18n/server";
import { UsersSettings } from "./users-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/users") };
}

export default function UsersPage() {
  return <UsersSettings />;
}
