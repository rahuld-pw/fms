import { QrReport } from "./qr-report";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("public.qr.metaTitle"), robots: { index: false } };
}

export default async function QrPage(props: PageProps<"/q/[token]">) {
  const { token } = await props.params;
  return <QrReport token={token} />;
}
