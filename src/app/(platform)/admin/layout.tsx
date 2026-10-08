import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, getSessionUser } from "@/lib/auth/context";
import { isPlatformAdmin } from "@/lib/auth/session-data";
import { LanguageSelect } from "@/components/shared/language-select";
import { PostFormButton } from "@/components/shared/post-form";
import { getT } from "@/lib/i18n/server";
import { AdminNav } from "./admin-nav";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: { template: t("admin.layout.titleTemplate"), default: t("admin.layout.platformAdmin") } };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isPlatformAdmin())) redirect("/");
  const hasOrg = !!(await getSessionContext());
  const { t } = await getT();
  return (
    <div className="min-h-dvh overflow-x-clip bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">C</span>
          <span className="hidden font-semibold tracking-tight sm:inline">Campus Ops</span>
          <span className="truncate rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">{t("admin.layout.platformAdmin")}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm sm:gap-3">
            {hasOrg && <Link href="/" className="text-muted-foreground hover:text-foreground">{t("admin.layout.openApp")}</Link>}
            <LanguageSelect compact />
            <span className="hidden text-muted-foreground md:inline">{user.email}</span>
            <PostFormButton action="/auth/signout" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50">{t("common.signOut")}</PostFormButton>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-6xl min-w-0 px-4 py-5 pb-16">{children}</main>
    </div>
  );
}
