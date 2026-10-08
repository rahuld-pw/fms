import { getT } from "@/lib/i18n/server";
import { OrgSettings } from "./org-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/org") };
}

export default function SettingsPage() {
  return <OrgSettings />;
}
