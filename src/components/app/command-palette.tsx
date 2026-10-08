"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Boxes, ClipboardList, FileText, FolderKanban, MapPin, Plus, Receipt, ShoppingCart, SquareCheck, Truck, Wrench } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { hasApprovals, NAV } from "@/lib/nav";
import { useCan, useSession } from "./session";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  issue: ClipboardList, asset: Boxes, vendor: Truck, location: MapPin, work_order: Wrench, expense_claim: Receipt,
  purchase_order: ShoppingCart, requisition: FileText, task: SquareCheck, project: FolderKanban,
};

interface Hit {
  entity_type: string;
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const { modules } = useSession();
  const can = useCan();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) => api<Hit[]>(`/search?q=${encodeURIComponent(debounced)}`, { signal }),
    enabled: debounced.length >= 2,
  });
  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  const { t } = useT();
  const pages = NAV.flatMap((s) => (s.module && !modules.includes(s.module) ? [] : s.items.filter((i) => !i.approvals || hasApprovals(modules)).map((i) => ({ ...i, label: t(`nav.${i.href}`, undefined, i.label), section: s.module ? t(`modules.${s.module}`, undefined, s.title) : s.title }))));
  const actions = [
    { label: t("quick.issue"), href: "/facility/issues/new", show: modules.includes("facility") && can("issue:report") },
    { label: t("shared.palette.newClaim"), href: "/expense/claims/new", show: modules.includes("expense") && can("expense:submit") },
    { label: t("shared.palette.newRequisition"), href: "/po/requisitions/new", show: modules.includes("po") && can("requisition:submit") },
    { label: t("shared.palette.newTask"), href: "/tasks?new=1", show: modules.includes("tasks") && can("task:create") },
  ].filter((a) => a.show);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("shared.palette.title")}</DialogTitle>
        <Command shouldFilter={debounced.length < 2}>
          <CommandInput placeholder={t("shared.palette.placeholder")} value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{isFetching ? t("shared.palette.searching") : t("ui.noResults")}</CommandEmpty>
            {hits.length > 0 && (
              <CommandGroup heading={t("shared.palette.results")}>
                {hits.map((h) => {
                  const Icon = ICONS[h.entity_type] ?? FileText;
                  return (
                    <CommandItem key={`${h.entity_type}:${h.id}`} value={`${h.title} ${h.subtitle ?? ""} ${h.id}`} onSelect={() => go(h.url)}>
                      <Icon />
                      <span className="truncate">{h.title}</span>
                      {h.subtitle && <span className="ml-auto truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {debounced.length < 2 && (
              <>
                {actions.length > 0 && (
                  <CommandGroup heading={t("ui.create")}>
                    {actions.map((a) => (
                      <CommandItem key={a.href} onSelect={() => go(a.href)}>
                        <Plus />
                        {a.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading={t("shared.palette.goTo")}>
                  {pages.map((p) => (
                    <CommandItem key={p.href} value={`${p.section ?? ""} ${p.label}`} onSelect={() => go(p.href)}>
                      <p.icon />
                      {p.section ? `${p.section} › ${p.label}` : p.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
