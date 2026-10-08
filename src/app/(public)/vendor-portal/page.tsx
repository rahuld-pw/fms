import { Suspense } from "react";
import { VendorPortal } from "./vendor-portal";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("public.vendor.metaTitle"), robots: { index: false } };
}

export default function VendorPortalPage() {
  return (
    <Suspense>
      <VendorPortal />
    </Suspense>
  );
}
