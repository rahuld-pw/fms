"use client";
import { useT } from "@/lib/i18n/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, apiList } from "@/lib/client/api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";
import { useSession } from "./session";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  type: string;
}

export function NotificationBell() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => apiList<Notification>("/notifications?limit=20", signal),
    refetchInterval: 60_000,
  });
  // Realtime: refresh when a notification row is inserted for me
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () =>
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [qc, user.id]);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api("/notifications/read", { body: { ids } }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<{ data: Notification[] }>(["notifications"]);
      qc.setQueryData<{ data: Notification[] }>(["notifications"], (old) =>
        old ? { ...old, data: old.data.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)) } : old,
      );
      return { prev };
    },
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(["notifications"], c.prev),
  });
  const items = data?.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? t("shared.notifications.labelUnread", { n: unread }) : t("shared.notifications.title")} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("shared.notifications.title")}</span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck /> {t("shared.notifications.markAllRead")}
            </Button>
          )}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto scrollbar-thin">
          {items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t("shared.notifications.caughtUp")}</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "#"}
              onClick={() => !n.read_at && markRead.mutate([n.id])}
              className={cn("flex gap-2.5 border-b px-3 py-2.5 last:border-0 hover:bg-muted/60", !n.read_at && "bg-accent/40")}
            >
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug">{n.title}</span>
                {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{relativeTime(n.created_at, locale)}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href="/notifications" className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted/60">
          {t("common.viewAll")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
