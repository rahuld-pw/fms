import { getT } from "@/lib/i18n/server";
import { ApiKeysSettings } from "./api-keys-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/api-keys") };
}

export default function ApiKeysPage() {
  return <ApiKeysSettings />;
}
