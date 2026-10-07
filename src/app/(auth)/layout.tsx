import Link from "next/link";
import { FeatureShowcase } from "./feature-showcase";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      {/* auth panel: first on phones, right-hand column on desktop */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 lg:order-2 lg:max-w-[560px] lg:px-12">
        <Link href="/" className="mb-6 flex items-center gap-2 self-center lg:self-start">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">C</span>
          <span className="text-lg font-semibold tracking-tight">Campus Ops</span>
        </Link>
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        <p className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Link href="/feedback?type=bug" className="hover:text-foreground hover:underline">Report a bug</Link>
          <Link href="/feedback?type=feature" className="hover:text-foreground hover:underline">Suggest a feature</Link>
          <Link href="/docs" className="hover:text-foreground hover:underline">API docs</Link>
        </p>
      </div>
      <FeatureShowcase />
    </div>
  );
}
