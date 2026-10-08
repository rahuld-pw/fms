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
import { useT } from "@/lib/i18n/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function TeamsPage() {
  const { t } = useT();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const teams = useQuery({ queryKey: ["/teams"], queryFn: () => apiList<any>("/teams?limit=100") });
  const rollup = useQuery({ queryKey: ["task-rollup"], queryFn: () => api<any[]>("/tasks/rollup") });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("tasks.teams.title")} description={t("tasks.teams.description")} actions={can("team:manage") && <Button onClick={() => setOpen(true)}><Plus /> {t("tasks.teams.newTeam")}</Button>} />
      {teams.data?.data.length === 0 && <EmptyState icon={Users} title={t("tasks.teams.empty")} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {teams.data?.data.map((team) => {
          const r = rollup.data?.find((x) => x.level === "team" && x.id === team.id);
          return (
            <Card key={team.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{team.name}</span>
                <AvatarStack names={(team.members ?? []).map((m: any) => m.profile?.full_name)} max={5} />
              </div>
              {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{r ? t("tasks.teams.tasksDone", { done: r.completed_tasks, total: r.total_tasks }) : t("tasks.teams.noTasks")}</span>{r?.overdue_tasks > 0 && <span className="text-destructive">{t("tasks.common.overdue", { n: r.overdue_tasks })}</span>}</div>
                <Progress value={r?.progress_pct ?? 0} />
              </div>
              <Button size="xs" variant="outline" className="self-start" onClick={() => setEditing(team)}>{t("tasks.teams.members")}</Button>
            </Card>
          );
        })}
      </div>
      <ResourceFormDialog open={open} onOpenChange={setOpen} title={t("tasks.teams.newTeam")} endpoint="/teams" fields={[{ name: "name", label: t("tasks.teams.fieldName"), required: true }, { name: "campus_id", label: t("tasks.teams.fieldCampus"), type: "campus" }, { name: "description", label: t("tasks.teams.fieldDescription"), type: "textarea" }]} invalidate={["/teams"]} />
      {editing && <MembersDialog team={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MembersDialog({ team, onClose }: { team: any; onClose: () => void }) {
  const { t } = useT();
  const [ids, setIds] = useState<string[]>((team.members ?? []).map((m: any) => m.user_id));
  const save = useAction({ success: t("tasks.teams.membersUpdated"), invalidate: ["/teams"], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("tasks.teams.membersTitle", { name: team.name })}</DialogTitle></DialogHeader>
        <Field label={t("tasks.teams.members")}><UserPicker multiple value={ids} onChange={(v) => setIds((v as string[]) ?? [])} /></Field>
        <DialogFooter>
          <Button loading={save.isPending} onClick={() => save.mutate({ path: `/teams/${team.id}/members`, method: "PUT", body: { members: ids.map((u) => ({ user_id: u, role: (team.members ?? []).find((m: any) => m.user_id === u)?.role ?? "member" })) } })}>{t("ui.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
