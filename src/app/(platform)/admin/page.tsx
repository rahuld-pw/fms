import { Organisations } from "./organisations";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.orgs.title") };
}

export default function AdminHome() {
  return <Organisations />;
}
