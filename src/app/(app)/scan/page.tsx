"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { QrScanner } from "@/components/shared/qr-scanner";
import { useT } from "@/lib/i18n/client";

interface Resolved { kind: "location" | "asset"; id: string; campus_id: string; name: string }

export default function ScanPage() {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const onScan = useCallback(
    async (token: string) => {
      if (busy) return;
      setBusy(true);
      const res = await fetch(`/api/v1/public/qr/${encodeURIComponent(token)}`);
      const json = await res.json();
      setBusy(false);
      if (!res.ok) return toast.error(t("scan.page.notRecognised"));
      const r = json.data as Resolved;
      if (r.kind === "asset") router.push(`/facility/assets/${r.id}`);
      else router.push(`/facility/issues/new?location=${r.id}&campus=${r.campus_id}`);
    },
    [busy, router, t],
  );
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t("scan.page.title")} description={t("scan.page.description")} />
      <QrScanner onScan={onScan} paused={busy} />
    </div>
  );
}
