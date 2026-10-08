import Link from "next/link";
import { LanguageSelect } from "@/components/shared/language-select";
import { getT } from "@/lib/i18n/server";
import { FeatureShowcase } from "./feature-showcase";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      {/* auth panel: first on phones, right-hand column on desktop */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 lg:order-2 lg:max-w-[560px] lg:px-12">
        <Link href="/" className="mb-6 flex items-center gap-2 self-center lg:self-start">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">C</span>
          <span className="text-lg font-semibold tracking-tight">Campus Ops</span>
        </Link>
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        <LanguageSelect className="mt-4 w-full max-w-sm" />
        <p className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Link href="/feedback?type=bug" className="hover:text-foreground hover:underline">{t("account.reportBug")}</Link>
          <Link href="/feedback?type=feature" className="hover:text-foreground hover:underline">{t("account.suggestFeature")}</Link>
          <Link href="/docs" className="hover:text-foreground hover:underline">{t("auth.apiDocs")}</Link>
        </p>
      </div>
      <FeatureShowcase />
    </div>
  );
}
