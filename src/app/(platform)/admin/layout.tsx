import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, getSessionUser } from "@/lib/auth/context";
import { isPlatformAdmin } from "@/lib/auth/session-data";
import { AdminNav } from "./admin-nav";

export const metadata = { title: { template: "%s · Platform admin", default: "Platform admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isPlatformAdmin())) redirect("/");
  const hasOrg = !!(await getSessionContext());
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">C</span>
          <span className="font-semibold tracking-tight">Campus Ops</span>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">Platform admin</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {hasOrg && <Link href="/" className="text-muted-foreground hover:text-foreground">Open app</Link>}
            <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
            <form action="/auth/signout" method="post"><button className="text-muted-foreground hover:text-foreground">Sign out</button></form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}
