"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";

interface Admin { user_id: string | null; email: string; full_name: string | null; created_at: string; pending: boolean }

export function PlatformAdmins() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "admins"], queryFn: () => api<Admin[]>("/admin/platform-admins") });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); qc.invalidateQueries({ queryKey: ["admin", "admins"] }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Platform admins" description="Can create and suspend organisations and manage licences. They don't see organisations' data." />
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4 sm:flex-row">
          <Input type="email" inputMode="email" autoCapitalize="none" placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button disabled={busy || !email.includes("@")} onClick={() => run(async () => { await api("/admin/platform-admins", { body: { email } }); setEmail(""); }, "Platform admin added")}>
            <ShieldPlus /> Add
          </Button>
        </CardContent>
        <p className="px-4 pb-3 text-xs text-muted-foreground">If the person has no account yet, they become a platform admin when they sign up with this email.</p>
      </Card>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : (
          <ul className="divide-y">
            {(data ?? []).map((a) => (
              <li key={a.email} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.full_name ?? a.email}</span>
                  <span className="block text-xs text-muted-foreground">{a.email} · since <DateTime value={a.created_at} dateOnly /></span>
                </span>
                {a.pending && <Badge tone="amber">Awaiting sign-up</Badge>}
                <Button size="xs" variant="ghost" className="text-destructive" disabled={busy}
                  onClick={() => confirm(`Remove ${a.email} as platform admin?`) && run(() => api(`/admin/platform-admins/${encodeURIComponent(a.email)}`, { method: "DELETE" }), "Removed")}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
