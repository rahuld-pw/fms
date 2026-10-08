import { getT } from "@/lib/i18n/server";
import { RolesSettings } from "./roles-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/roles") };
}

export default function RolesPage() {
  return <RolesSettings />;
}
