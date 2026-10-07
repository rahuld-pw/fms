"use client";
import { toast } from "sonner";
import { errorMessage } from "@/lib/client/api";

/** Opens a printable PDF sheet of QR labels for the given assets/locations. */
export async function printLabels(kind: "asset" | "location", ids: string[]) {
  try {
    const res = await fetch("/api/v1/qr/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ids }) });
    if (!res.ok) throw new Error((await res.json()).error?.message ?? "Failed");
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
