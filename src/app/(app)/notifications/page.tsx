"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { DateTime } from "@/components/shared/format";
import { api, apiList } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

interface N { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export default function NotificationsPage() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ["notifications-all"],
    queryFn: ({ pageParam }) => apiList<N>(`/notifications?limit=30${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
  });
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read", { body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-all"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/settings/profile">Preferences</Link></Button>
            <Button size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>Mark all read</Button>
          </>
        }
      />
      {rows.length === 0 && !q.isLoading && <EmptyState icon={Bell} title="No notifications" />}
      <Card className="divide-y empty:hidden">
        {rows.map((n) => (
          <Link key={n.id} href={n.link ?? "#"} className={cn("flex gap-3 px-4 py-3 hover:bg-muted/40", !n.read_at && "bg-accent/30")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{n.title}</p>
              {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
            </div>
            <span className="text-xs text-muted-foreground"><DateTime value={n.created_at} relative /></span>
          </Link>
        ))}
      </Card>
      {q.hasNextPage && (
        <Button variant="outline" className="mt-3 w-full" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
