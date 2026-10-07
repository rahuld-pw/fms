import { SettingsNav } from "@/components/app/sidebar";

export const metadata = { title: { template: "%s · Settings", default: "Settings" } };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:gap-8">
      <aside className="-mx-3 border-b px-3 pb-2 md:sticky md:top-20 md:mx-0 md:h-fit md:w-48 md:shrink-0 md:border-0 md:p-0">
        <SettingsNav />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
