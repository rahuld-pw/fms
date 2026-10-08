import { getT } from "@/lib/i18n/server";
import { PlatformAnalytics } from "./platform-analytics";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("analytics.title") };
}

export default function AdminAnalyticsPage() {
  return <PlatformAnalytics />;
}
