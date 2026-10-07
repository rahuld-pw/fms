import { MobileNav } from "@/components/app/mobile-nav";
import { SessionProvider } from "@/components/app/session";
import { SidebarNav } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { requireSession } from "@/lib/auth/session-data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data } = await requireSession();
  return (
    <SessionProvider value={data}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar md:block">
          <SidebarNav />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-3 pt-4 pb-24 md:px-6 md:pb-10">{children}</main>
        </div>
      </div>
      <MobileNav />
    </SessionProvider>
  );
}
