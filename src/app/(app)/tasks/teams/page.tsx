"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { useCan } from "@/components/app/session";
import { AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Field, UserPicker } from "@/components/shared/fields";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog, useAction } from "@/components/shared/resource-form";
import { api, apiList } from "@/lib/client/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function TeamsPage() {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const teams = useQuery({ queryKey: ["/teams"], queryFn: () => apiList<any>("/teams?limit=100") });
  const rollup = useQuery({ queryKey: ["task-rollup"], queryFn: () => api<any[]>("/tasks/rollup") });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Teams" description="Teams own projects; progress rolls up from tasks." actions={can("team:manage") && <Button onClick={() => setOpen(true)}><Plus /> New team</Button>} />
      {teams.data?.data.length === 0 && <EmptyState icon={Users} title="No teams yet" />}
      <div className="grid gap-3 sm:grid-cols-2">
        {teams.data?.data.map((t) => {
          const r = rollup.data?.find((x) => x.level === "team" && x.id === t.id);
          return (
            <Card key={t.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                <AvatarStack names={(t.members ?? []).map((m: any) => m.profile?.full_name)} max={5} />
              </div>
              {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{r ? `${r.completed_tasks}/${r.total_tasks} tasks done` : "No tasks yet"}</span>{r?.overdue_tasks > 0 && <span className="text-destructive">{r.overdue_tasks} overdue</span>}</div>
                <Progress value={r?.progress_pct ?? 0} />
              </div>
              <Button size="xs" variant="outline" className="self-start" onClick={() => setEditing(t)}>Members</Button>
            </Card>
          );
        })}
      </div>
      <ResourceFormDialog open={open} onOpenChange={setOpen} title="New team" endpoint="/teams" fields={[{ name: "name", label: "Name", required: true }, { name: "campus_id", label: "Campus", type: "campus" }, { name: "description", label: "Description", type: "textarea" }]} invalidate={["/teams"]} />
      {editing && <MembersDialog team={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MembersDialog({ team, onClose }: { team: any; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>((team.members ?? []).map((m: any) => m.user_id));
  const save = useAction({ success: "Members updated", invalidate: ["/teams"], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{team.name} members</DialogTitle></DialogHeader>
        <Field label="Members"><UserPicker multiple value={ids} onChange={(v) => setIds((v as string[]) ?? [])} /></Field>
        <DialogFooter>
          <Button loading={save.isPending} onClick={() => save.mutate({ path: `/teams/${team.id}/members`, method: "PUT", body: { members: ids.map((u) => ({ user_id: u, role: (team.members ?? []).find((m: any) => m.user_id === u)?.role ?? "member" })) } })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
