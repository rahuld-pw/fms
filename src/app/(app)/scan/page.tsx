"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { QrScanner } from "@/components/shared/qr-scanner";

interface Resolved { kind: "location" | "asset"; id: string; campus_id: string; name: string }

export default function ScanPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onScan = useCallback(
    async (token: string) => {
      if (busy) return;
      setBusy(true);
      const res = await fetch(`/api/v1/public/qr/${encodeURIComponent(token)}`);
      const json = await res.json();
      setBusy(false);
      if (!res.ok) return toast.error("QR code not recognised");
      const r = json.data as Resolved;
      if (r.kind === "asset") router.push(`/facility/assets/${r.id}`);
      else router.push(`/facility/issues/new?location=${r.id}&campus=${r.campus_id}`);
    },
    [busy, router],
  );
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Scan a QR code" description="Scan a room or asset tag to report an issue or open the asset." />
      <QrScanner onScan={onScan} paused={busy} />
    </div>
  );
}
