import { getT } from "@/lib/i18n/server";
import { InvoiceDetail } from "./invoice-detail";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("po.meta.invoice") };
}

export default async function InvoicePage(props: PageProps<"/po/invoices/[id]">) {
  const { id } = await props.params;
  return <InvoiceDetail id={id} />;
}
