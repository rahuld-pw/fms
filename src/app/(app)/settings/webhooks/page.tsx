import { getT } from "@/lib/i18n/server";
import { WebhooksSettings } from "./webhooks-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/webhooks") };
}

export default function WebhooksPage() {
  return <WebhooksSettings />;
}
