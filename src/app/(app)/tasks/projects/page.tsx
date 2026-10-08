"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DueDate } from "@/components/shared/format";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { api, apiList } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLORS: Record<string, string> = { green: "bg-emerald-500", blue: "bg-sky-500", violet: "bg-violet-500", red: "bg-rose-500", amber: "bg-amber-500", teal: "bg-teal-500" };

export default function ProjectsPage() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const [dialog, setDialog] = useState<"new" | "template" | null>(null);
  const projects = useQuery({ queryKey: ["/projects"], queryFn: () => apiList<any>("/projects?limit=200&is_template=false&status=active,on_hold") });
  const templates = useQuery({ queryKey: ["/projects", "templates"], queryFn: () => apiList<any>("/projects?limit=100&is_template=true") });
  const rollup = useQuery({ queryKey: ["task-rollup"], queryFn: () => api<any[]>("/tasks/rollup") });
  const prog = (id: string) => rollup.data?.find((r) => r.level === "project" && r.id === id);
  const org = rollup.data?.find((r) => r.level === "org");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("tasks.projects.title")}
        description={org ? t("tasks.projects.summary", { done: org.completed_tasks, total: org.total_tasks, pct: org.progress_pct }) : undefined}
        actions={
          can("project:create") && (
            <>
              {templates.data?.data.length ? <Button variant="outline" onClick={() => setDialog("template")}>{t("tasks.projects.fromTemplate")}</Button> : null}
              <Button onClick={() => setDialog("new")}><Plus /> {t("tasks.projects.newProject")}</Button>
            </>
          )
        }
      />
      {projects.isLoading && <Skeleton className="h-40" />}
      {projects.data?.data.length === 0 && <EmptyState icon={FolderKanban} title={t("tasks.projects.empty")} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.data?.data.map((p) => {
          const r = prog(p.id);
          return (
            <Link key={p.id} href={`/tasks/projects/${p.id}`} className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20">
              <div className="flex items-center gap-2">
                <span className={`size-3 rounded ${COLORS[p.color] ?? "bg-emerald-500"}`} />
                <span className="truncate font-medium">{p.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{p.team?.name ?? t("tasks.projects.noTeam")} · {t(`enum.projectVisibility.${p.visibility}`, undefined, p.visibility)}</p>
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{r ? t("tasks.projects.done", { done: r.completed_tasks, total: r.total_tasks }) : "—"}</span>
                  {r?.overdue_tasks > 0 && <span className="text-destructive">{t("tasks.common.overdue", { n: r.overdue_tasks })}</span>}
                </div>
                <Progress value={r?.progress_pct ?? 0} />
              </div>
              {p.due_date && <span className="text-xs">{t("tasks.common.due")} <DueDate value={p.due_date} /></span>}
            </Link>
          );
        })}
      </div>
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("tasks.projects.newProject")}
        endpoint="/projects"
        fields={[
          { name: "name", label: t("tasks.projects.fieldName"), required: true, full: true },
          { name: "team_id", label: t("tasks.projects.fieldTeam"), type: "resource", endpoint: "/teams" },
          { name: "visibility", label: t("tasks.projects.fieldVisibility"), type: "select", required: true, options: [{ value: "team", label: t("tasks.projects.visibilityTeam") }, { value: "org", label: t("tasks.projects.visibilityOrg") }, { value: "private", label: t("tasks.projects.visibilityPrivate") }] },
          { name: "default_view", label: t("tasks.projects.fieldDefaultView"), type: "select", options: ["list", "board", "calendar", "timeline"].map((v) => ({ value: v, label: t(`tasks.project.views.${v}`) })) },
          { name: "color", label: t("tasks.projects.fieldColour"), type: "select", options: Object.keys(COLORS).map((c) => ({ value: c, label: t(`tasks.projects.colors.${c}`, undefined, c) })) },
          { name: "start_date", label: t("tasks.projects.fieldStart"), type: "date" },
          { name: "due_date", label: t("tasks.projects.fieldDue"), type: "date" },
          { name: "is_template", label: t("tasks.projects.fieldIsTemplate"), type: "switch" },
          { name: "description", label: t("tasks.projects.fieldDescription"), type: "textarea" },
        ]}
        defaultValues={{ visibility: "team", default_view: "board", color: "green" }}
        invalidate={["/projects", "task-rollup"]}
        onSaved={(r: { id: string }) => router.push(`/tasks/projects/${r.id}`)}
      />
      <ResourceFormDialog
        open={dialog === "template"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("tasks.projects.templateTitle")}
        description={t("tasks.projects.templateDescription")}
        endpoint="/projects/from-template"
        fields={[
          { name: "template_id", label: t("tasks.projects.fieldTemplate"), type: "select", required: true, options: (templates.data?.data ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name })) },
          { name: "name", label: t("tasks.projects.fieldProjectName"), required: true },
          { name: "team_id", label: t("tasks.projects.fieldTeam"), type: "resource", endpoint: "/teams" },
          { name: "start_date", label: t("tasks.projects.fieldStartDate"), type: "date" },
        ]}
        defaultValues={{ start_date: new Date().toISOString().slice(0, 10) }}
        invalidate={["/projects"]}
        onSaved={(r: { id: string }) => router.push(`/tasks/projects/${r.id}`)}
      />
    </div>
  );
}
