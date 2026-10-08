"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, Home, Inbox, QrCode } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { hasApprovals } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";
import { useCan, useSession } from "./session";

/** Thumb-reachable bottom bar on phones: the field actions people use most. */
export function MobileNav() {
  const pathname = usePathname();
  const { modules } = useSession();
  const can = useCan();
  const { t } = useT();
  const items = [
    { href: "/", label: "Home", icon: Home, show: true },
    { href: "/scan", label: "Scan", icon: QrCode, show: modules.includes("facility") },
    { href: "/approvals", label: "Approvals", icon: Inbox, show: hasApprovals(modules) },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, show: modules.includes("tasks") && can("task:read") },
  ].filter((i) => i.show);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label={t("shared.nav.quick")}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
            <Icon className="size-5" />
            {t(`nav.${href}`, undefined, label)}
          </Link>
        );
      })}
    </nav>
  );
}
