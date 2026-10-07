import { QrReport } from "./qr-report";

export const metadata = { title: "Report an issue", robots: { index: false } };

export default async function QrPage(props: PageProps<"/q/[token]">) {
  const { token } = await props.params;
  return <QrReport token={token} />;
}
