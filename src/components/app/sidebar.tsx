"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasApprovals, NAV, SETTINGS_NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";
import { useCan, useSession } from "./session";

// Settings that matter in a personal (Tasks-only) workspace
const PERSONAL_SETTINGS = new Set(["/settings", "/settings/users"]);

function useVisible() {
  const { modules, org } = useSession();
  const can = useCan();
  return (item: NavItem) =>
    (!item.module || modules.includes(item.module)) &&
    (!item.approvals || hasApprovals(modules)) &&
    (!item.anyOf || item.anyOf.some((p) => can(p))) &&
    (org.kind !== "personal" || !item.href.startsWith("/settings") || PERSONAL_SETTINGS.has(item.href));
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // exact match for module overview pages so children don't highlight them
  if (["/facility", "/expense", "/po", "/tasks", "/settings"].includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const visible = useVisible();
  const { modules, org } = useSession();
  const settings = SETTINGS_NAV.filter(visible);
  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-2.5 py-3 scrollbar-thin" aria-label="Main">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-2 py-1">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          {org.name.slice(0, 1)}
        </span>
        <span className="truncate text-sm font-semibold">{org.name}</span>
      </Link>
      {NAV.filter((s) => !s.module || modules.includes(s.module)).map((section, i) => {
        const items = section.items.filter(visible);
        if (items.length === 0) return null;
        return (
          <div key={i} className="flex flex-col gap-0.5">
            {section.title && <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{section.title}</div>}
            {items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
      {settings.length > 0 && (
        <div className="mt-auto flex flex-col gap-0.5 border-t pt-3">
          <NavLink item={{ ...settings[0], label: "Settings" }} active={pathname.startsWith("/settings")} onNavigate={onNavigate} />
        </div>
      )}
    </nav>
  );
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground transition-colors hover:bg-muted",
        active && "bg-sidebar-active font-medium text-sidebar-active-foreground hover:bg-sidebar-active",
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function SettingsNav() {
  const pathname = usePathname();
  const visible = useVisible();
  return (
    <nav className="flex gap-1 overflow-x-auto scrollbar-thin md:flex-col" aria-label="Settings">
      {SETTINGS_NAV.filter(visible).map((item) => (
        <NavLink key={item.href} item={item} active={item.href === "/settings" ? pathname === "/settings" : pathname.startsWith(item.href)} />
      ))}
      <NavLink item={{ label: "My profile", href: "/settings/profile", icon: SETTINGS_NAV[1].icon }} active={pathname === "/settings/profile"} />
    </nav>
  );
}
