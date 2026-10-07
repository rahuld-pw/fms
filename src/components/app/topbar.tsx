"use client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, Check, LogOut, Menu, Monitor, Moon, Plus, Search, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/client/api";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notifications";
import { useCan, useSession } from "./session";
import { SidebarNav } from "./sidebar";

export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const { user, org, orgs, modules } = useSession();
  const can = useCan();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switchOrg = async (id: string) => {
    try {
      await api("/me/org", { body: { org_id: id } });
      qc.clear(); // cached data belongs to the previous org
      router.replace("/");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const quick = [
    { label: "Report an issue", href: "/facility/issues/new", show: modules.includes("facility") && can("issue:report") },
    { label: "Expense claim", href: "/expense/claims/new", show: modules.includes("expense") && can("expense:submit") },
    { label: "Requisition", href: "/po/requisitions/new", show: modules.includes("po") && can("requisition:submit") },
    { label: "Task", href: "/tasks?new=1", show: modules.includes("tasks") && can("task:create") },
  ].filter((q) => q.show);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-5">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
        <Menu />
      </Button>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" aria-describedby={undefined} className="bg-sidebar p-0">
          <span className="sr-only" role="heading" aria-level={2}>Navigation</span>
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Dialog>

      <button
        onClick={() => setSearchOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="truncate">Search…</span>
        <kbd className="ml-auto hidden rounded border bg-background px-1.5 text-[10px] font-medium sm:inline">⌘K</kbd>
      </button>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="ml-auto flex items-center gap-1">
        {quick.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="hidden sm:inline-flex">
                <Plus /> New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {quick.map((q) => (
                <DropdownMenuItem key={q.href} onSelect={() => router.push(q.href)}>
                  {q.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label="Account menu">
              <Avatar name={user.full_name ?? user.email} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-sm font-medium text-foreground">{user.full_name}</div>
              <div className="truncate text-xs">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings/profile")}>
              <User /> Profile & notifications
            </DropdownMenuItem>
            {orgs.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Organisations</DropdownMenuLabel>
                {orgs.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => o.id !== org.id && switchOrg(o.id)}>
                    <Building2 /> <span className="truncate">{o.name}</span>
                    {o.id === org.id && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <div className="flex gap-1 px-2 pb-1.5">
              {[
                { v: "light", icon: Sun },
                { v: "dark", icon: Moon },
                { v: "system", icon: Monitor },
              ].map(({ v, icon: Icon }) => (
                <Button key={v} variant={theme === v ? "secondary" : "ghost"} size="icon-sm" onClick={() => setTheme(v)} aria-label={`${v} theme`}>
                  <Icon />
                </Button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <form action="/auth/signout" method="post">
              <button type="submit" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                <LogOut className="size-4 text-muted-foreground" /> Sign out
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
