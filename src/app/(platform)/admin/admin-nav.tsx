"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

const ITEMS = [
  { href: "/admin", labelKey: "admin.nav.organisations", icon: Building2 },
  { href: "/admin/analytics", labelKey: "admin.nav.analytics", icon: BarChart3 },
  { href: "/admin/feedback", labelKey: "admin.nav.feedback", icon: MessageSquareWarning },
  { href: "/admin/admins", labelKey: "admin.nav.platformAdmins", icon: ShieldCheck },
];

export function AdminNav() {
  const pathname = usePathname();
  const { t } = useT();
  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4" aria-label={t("admin.layout.platformAdmin")}>
      {ITEMS.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <i.icon className="size-4" /> {t(i.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
