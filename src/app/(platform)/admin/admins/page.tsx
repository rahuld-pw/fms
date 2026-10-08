import { PlatformAdmins } from "./platform-admins";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.admins.title") };
}

export default function AdminsPage() {
  return <PlatformAdmins />;
}
