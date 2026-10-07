import { Suspense } from "react";
import { ConfigurationSettings } from "./configuration-settings";

export const metadata = { title: "Configuration" };

export default function ConfigurationPage() {
  return (
    <Suspense>
      <ConfigurationSettings />
    </Suspense>
  );
}
