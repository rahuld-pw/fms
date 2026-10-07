import { InvoiceDetail } from "./invoice-detail";

export const metadata = { title: "Invoice" };

export default async function InvoicePage(props: PageProps<"/po/invoices/[id]">) {
  const { id } = await props.params;
  return <InvoiceDetail id={id} />;
}
