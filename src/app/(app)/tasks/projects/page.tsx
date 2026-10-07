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

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLORS: Record<string, string> = { green: "bg-emerald-500", blue: "bg-sky-500", violet: "bg-violet-500", red: "bg-rose-500", amber: "bg-amber-500", teal: "bg-teal-500" };

export default function ProjectsPage() {
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
        title="Projects"
        description={org ? `${org.completed_tasks} of ${org.total_tasks} tasks complete across the organisation (${org.progress_pct}%)` : undefined}
        actions={
          can("project:create") && (
            <>
              {templates.data?.data.length ? <Button variant="outline" onClick={() => setDialog("template")}>From template</Button> : null}
              <Button onClick={() => setDialog("new")}><Plus /> New project</Button>
            </>
          )
        }
      />
      {projects.isLoading && <Skeleton className="h-40" />}
      {projects.data?.data.length === 0 && <EmptyState icon={FolderKanban} title="No projects yet" />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.data?.data.map((p) => {
          const r = prog(p.id);
          return (
            <Link key={p.id} href={`/tasks/projects/${p.id}`} className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20">
              <div className="flex items-center gap-2">
                <span className={`size-3 rounded ${COLORS[p.color] ?? "bg-emerald-500"}`} />
                <span className="truncate font-medium">{p.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{p.team?.name ?? "No team"} · {p.visibility}</p>
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{r ? `${r.completed_tasks}/${r.total_tasks} done` : "—"}</span>
                  {r?.overdue_tasks > 0 && <span className="text-destructive">{r.overdue_tasks} overdue</span>}
                </div>
                <Progress value={r?.progress_pct ?? 0} />
              </div>
              {p.due_date && <span className="text-xs">Due <DueDate value={p.due_date} /></span>}
            </Link>
          );
        })}
      </div>
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New project"
        endpoint="/projects"
        fields={[
          { name: "name", label: "Name", required: true, full: true },
          { name: "team_id", label: "Team", type: "resource", endpoint: "/teams" },
          { name: "visibility", label: "Visibility", type: "select", required: true, options: [{ value: "team", label: "Team members" }, { value: "org", label: "Everyone in the organisation" }, { value: "private", label: "Only project members" }] },
          { name: "default_view", label: "Default view", type: "select", options: ["list", "board", "calendar", "timeline"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
          { name: "color", label: "Colour", type: "select", options: Object.keys(COLORS).map((c) => ({ value: c, label: c })) },
          { name: "start_date", label: "Start", type: "date" },
          { name: "due_date", label: "Due", type: "date" },
          { name: "is_template", label: "Save as a template", type: "switch" },
          { name: "description", label: "Description", type: "textarea" },
        ]}
        defaultValues={{ visibility: "team", default_view: "board", color: "green" }}
        invalidate={["/projects", "task-rollup"]}
        onSaved={(r: { id: string }) => router.push(`/tasks/projects/${r.id}`)}
      />
      <ResourceFormDialog
        open={dialog === "template"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New project from template"
        description="Sections, tasks, subtasks and dependencies are copied; dates shift to the start date."
        endpoint="/projects/from-template"
        fields={[
          { name: "template_id", label: "Template", type: "select", required: true, options: (templates.data?.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
          { name: "name", label: "Project name", required: true },
          { name: "team_id", label: "Team", type: "resource", endpoint: "/teams" },
          { name: "start_date", label: "Start date", type: "date" },
        ]}
        defaultValues={{ start_date: new Date().toISOString().slice(0, 10) }}
        invalidate={["/projects"]}
        onSaved={(r: { id: string }) => router.push(`/tasks/projects/${r.id}`)}
      />
    </div>
  );
}
