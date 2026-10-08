import { Suspense } from "react";
import { getT } from "@/lib/i18n/server";
import { ConfigurationSettings } from "./configuration-settings";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav./settings/configuration") };
}

export default function ConfigurationPage() {
  return (
    <Suspense>
      <ConfigurationSettings />
    </Suspense>
  );
}
