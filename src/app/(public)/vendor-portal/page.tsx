import { Suspense } from "react";
import { VendorPortal } from "./vendor-portal";

export const metadata = { title: "Vendor portal", robots: { index: false } };

export default function VendorPortalPage() {
  return (
    <Suspense>
      <VendorPortal />
    </Suspense>
  );
}
