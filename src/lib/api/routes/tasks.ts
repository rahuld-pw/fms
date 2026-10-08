import "server-only";
import { z } from "zod";
import { crudRoutes } from "@/lib/api/crud";
import { ApiError, unwrap } from "@/lib/api/errors";
import { listParamsSchema } from "@/lib/api/pagination";
import { route, type RouteDef } from "@/lib/api/router";
import { customFields, isoDate, name, optUuid, taskPriority } from "@/lib/schemas/common";
import { getResource, listResource, type Query, type ResourceSpec } from "@/lib/services/resource";

const M = "tasks" as const;
const db = (ctx: { kind: string; admin: () => import("@/lib/supabase/server").DB; db: import("@/lib/supabase/server").DB }) =>
  ctx.kind === "api_key" ? ctx.admin() : ctx.db;

export const teams: ResourceSpec = {
  name: "teams",
  entityType: "team",
  table: "teams",
  module: M,
  permission: "team",
  readPermission: "task:read",
  createPermission: "team:manage",
  updatePermission: "team:manage",
  deletePermission: "team:manage",
  select: "*, members:team_members(user_id, role, profile:profiles(id, full_name, avatar_path))",
  sortable: ["name", "created_at"],
  defaultSort: "name",
  search: ["name"],
  softDelete: true,
  createSchema: z.object({ name, description: z.string().max(1000).nullable().optional(), color: z.string().max(20).optional(), campus_id: optUuid }),
  updateSchema: z.object({ name, description: z.string().max(1000).nullable(), color: z.string().max(20), campus_id: z.uuid().nullable() }).partial(),
  afterCreate: async (ctx, row) => {
    unwrap(await db(ctx).from("team_members").insert({ team_id: row.id, user_id: ctx.userId, org_id: ctx.orgId, role: "lead" }));
  },
};

const projectSchema = z.object({
  team_id: optUuid,
  name,
  description: z.string().max(5000).nullable().optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(40).nullable().optional(),
  status: z.enum(["active", "on_hold", "completed", "archived"]).optional(),
  health: z.enum(["on_track", "at_risk", "off_track"]).nullable().optional(),
  visibility: z.enum(["org", "team", "private"]).default("team"),
  default_view: z.enum(["list", "board", "calendar", "timeline"]).default("list"),
  owner_id: optUuid,
  start_date: isoDate.nullable().optional(),
  due_date: isoDate.nullable().optional(),
  is_template: z.boolean().default(false),
  sections: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  custom_fields: customFields,
});
export const projects: ResourceSpec = {
  name: "projects",
  entityType: "project",
  table: "projects",
  module: M,
  permission: "project",
  readPermission: "task:read",
  createPermission: "project:create",
  updatePermission: "project:create",
  deletePermission: "project:manage",
  select: "*, team:teams(id, name), owner:profiles!projects_owner_id_fkey(id, full_name)",
  filters: { team_id: "eq", status: "in", is_template: "bool", owner_id: "user", visibility: "in" },
  sortable: ["name", "created_at", "due_date"],
  defaultSort: "name",
  search: ["name"],
  softDelete: true,
  customFields: true,
  createSchema: projectSchema,
  updateSchema: projectSchema.omit({ sections: true }).partial(),
  prepareCreate: (ctx, input) => {
    const { sections: _s, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, owner_id: input.owner_id ?? ctx.userId, created_by: ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    const d = db(ctx);
    unwrap(await d.from("project_members").insert({ project_id: row.id, user_id: ctx.userId, org_id: ctx.orgId, role: "admin" }));
    const sections = (input.sections as string[] | undefined) ?? ["To do", "In progress", "Done"];
    if (sections.length)
      unwrap(await d.from("sections").insert(sections.map((n, i) => ({ org_id: ctx.orgId, project_id: row.id, name: n, position: (i + 1) * 1024 }))));
  },
};

const taskCreate = z.object({
  project_id: optUuid,
  section_id: optUuid,
  parent_task_id: optUuid,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(),
  priority: taskPriority.optional(),
  start_date: isoDate.nullable().optional(),
  due_date: isoDate.nullable().optional(),
  due_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  position: z.number().optional(),
  estimated_hours: z.number().min(0).max(10000).nullable().optional(),
  is_milestone: z.boolean().optional(),
  recurrence: z
    .object({ freq: z.enum(["daily", "weekly", "monthly", "yearly"]), interval: z.number().int().min(1).max(365).default(1), until: isoDate.optional() })
    .nullable()
    .optional(),
  assignee_ids: z.array(z.uuid()).max(20).optional(),
  follower_ids: z.array(z.uuid()).max(50).optional(),
  custom_fields: customFields,
});

const taskSelect =
  "*, project:projects(id, name, color), section:sections(id, name), assignees:task_assignees(user_id, profile:profiles(id, full_name, avatar_path)), subtask_count:tasks!parent_task_id(count)";

export const tasks: ResourceSpec = {
  name: "tasks",
  entityType: "task",
  table: "tasks",
  module: M,
  permission: "task",
  readPermission: "task:read",
  deletePermission: "project:manage",
  select: taskSelect,
  detailSelect:
    "*, project:projects(id, name, color), section:sections(id, name), parent:tasks!parent_task_id(id, title), assignees:task_assignees(user_id, profile:profiles(id, full_name, avatar_path)), followers:task_followers(user_id, profile:profiles(id, full_name)), dependencies:task_dependencies!task_dependencies_task_id_fkey(depends_on_task_id, task:tasks!task_dependencies_depends_on_task_id_fkey(id, title, status)), links:task_links(id, entity_type, entity_id), subtasks:tasks!parent_task_id(id, title, status, due_date, position)",
  filters: {
    project_id: "eq",
    section_id: "eq",
    parent_task_id: "eq",
    status: "in",
    priority: "in",
    due_date: "range",
    start_date: "range",
    created_by: "user",
    is_milestone: "bool",
  },
  sortable: ["position", "due_date", "created_at", "priority", "title", "start_date", "updated_at"],
  defaultSort: "position",
  search: ["title"],
  softDelete: true,
  customFields: true,
  createSchema: taskCreate,
  updateSchema: taskCreate.omit({ assignee_ids: true, follower_ids: true, parent_task_id: true }).partial(),
  prepareCreate: (ctx, input) => {
    const { assignee_ids: _a, follower_ids: _f, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, created_by: ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    const d = db(ctx);
    const assignees = (input.assignee_ids as string[] | undefined) ?? [];
    const followers = (input.follower_ids as string[] | undefined) ?? [];
    if (assignees.length) unwrap(await d.from("task_assignees").insert(assignees.map((u) => ({ task_id: row.id, user_id: u, org_id: ctx.orgId }))));
    if (followers.length)
      unwrap(await d.from("task_followers").upsert(followers.map((u) => ({ task_id: row.id, user_id: u, org_id: ctx.orgId }))));
  },
  csvColumns: [
    ["title", "Title"], ["project.name", "Project"], ["section.name", "Section"], ["status", "Status"], ["priority", "Priority"],
    ["start_date", "Start"], ["due_date", "Due"], ["completed_at", "Completed"], ["estimated_hours", "Estimate (h)"],
  ],
};

export const taskTemplates: ResourceSpec = {
  name: "task-templates",
  entityType: "task_template",
  table: "task_templates",
  module: M,
  permission: "project",
  readPermission: "task:read",
  createPermission: "project:create",
  updatePermission: "project:create",
  deletePermission: "project:create",
  sortable: ["name", "created_at"],
  defaultSort: "name",
  search: ["name"],
  createSchema: z.object({
    name,
    description: z.string().max(1000).nullable().optional(),
    payload: z.object({
      title: z.string().max(500).optional(),
      description: z.string().max(20000).optional(),
      priority: taskPriority.optional(),
      due_in_days: z.number().int().min(0).max(3650).optional(),
      subtasks: z.array(z.object({ title: z.string().min(1).max(500), due_in_days: z.number().int().min(0).max(3650).optional() })).max(100).optional(),
    }),
  }),
  updateSchema: z.object({ name, description: z.string().max(1000).nullable(), payload: z.record(z.string(), z.unknown()) }).partial(),
  prepareCreate: (ctx, input) => ({ ...input, created_by: ctx.userId }),
};

const userIds = z.object({ user_ids: z.array(z.uuid()).max(50) });

export const taskRoutes: RouteDef[] = [
  ...crudRoutes(teams),
  route({
    method: "PUT",
    path: "/teams/:id/members",
    summary: "Replace team members",
    tags: ["teams"],
    module: M,
    status: 200,
    body: z.object({ members: z.array(z.object({ user_id: z.uuid(), role: z.enum(["member", "lead"]).default("member") })).max(500) }),
    handler: async ({ ctx, params, body }) => {
      await getResource(ctx, teams, params.id);
      const d = db(ctx);
      unwrap(await d.from("team_members").delete().eq("team_id", params.id).eq("org_id", ctx.orgId));
      if (body.members.length) unwrap(await d.from("team_members").insert(body.members.map((m) => ({ ...m, team_id: params.id, org_id: ctx.orgId }))));
      return getResource(ctx, teams, params.id);
    },
  }),
  ...crudRoutes(projects),
  route({
    method: "GET",
    path: "/projects/:id/board",
    summary: "Sections with their top-level tasks (board / list views)",
    tags: ["projects"],
    module: M,
    handler: async ({ ctx, params }) => {
      const project = await getResource(ctx, projects, params.id);
      const [sections, items] = await Promise.all([
        ctx.db.from("sections").select("*").eq("project_id", params.id).order("position"),
        ctx.db
          .from("tasks")
          .select(taskSelect)
          .eq("project_id", params.id)
          .is("parent_task_id", null)
          .is("deleted_at", null)
          .order("position")
          .limit(2000),
      ]);
      return { project, sections: unwrap(sections), tasks: unwrap(items) };
    },
  }),
  route({
    method: "GET",
    path: "/projects/:id/members",
    summary: "Project members",
    tags: ["projects"],
    module: M,
    handler: async ({ ctx, params }) =>
      unwrap(await ctx.db.from("project_members").select("*, profile:profiles(id, full_name, avatar_path)").eq("project_id", params.id)),
  }),
  route({
    method: "PUT",
    path: "/projects/:id/members",
    summary: "Replace project members",
    tags: ["projects"],
    module: M,
    status: 200,
    body: z.object({ members: z.array(z.object({ user_id: z.uuid(), role: z.enum(["viewer", "commenter", "editor", "admin"]).default("editor") })).max(500) }),
    handler: async ({ ctx, params, body }) => {
      await getResource(ctx, projects, params.id);
      const d = db(ctx);
      unwrap(await d.from("project_members").delete().eq("project_id", params.id));
      if (body.members.length) unwrap(await d.from("project_members").insert(body.members.map((m) => ({ ...m, project_id: params.id, org_id: ctx.orgId }))));
      return unwrap(await ctx.db.from("project_members").select("*").eq("project_id", params.id));
    },
  }),
  route({
    method: "POST",
    path: "/projects/:id/sections",
    summary: "Add a section",
    tags: ["projects"],
    module: M,
    body: z.object({ name: z.string().trim().min(1).max(100), position: z.number().optional() }),
    handler: async ({ ctx, params, body }) =>
      unwrap(
        await db(ctx)
          .from("sections")
          .insert({ org_id: ctx.orgId, project_id: params.id, name: body.name, position: body.position ?? Date.now() / 1000 })
          .select("*")
          .single(),
      ),
  }),
  route({
    method: "PATCH",
    path: "/sections/:id",
    summary: "Rename or move a section",
    tags: ["projects"],
    module: M,
    body: z.object({ name: z.string().trim().min(1).max(100), position: z.number() }).partial(),
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("sections").update(body).eq("id", params.id).eq("org_id", ctx.orgId).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/sections/:id",
    summary: "Delete a section (tasks move to no section)",
    tags: ["projects"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await db(ctx).from("sections").delete().eq("id", params.id).eq("org_id", ctx.orgId));
    },
  }),
  route({
    method: "POST",
    path: "/projects/from-template",
    summary: "Create a project from a template project (dates shift to the start date)",
    tags: ["projects"],
    module: M,
    body: z.object({ template_id: z.uuid(), name, team_id: optUuid, start_date: isoDate.optional() }),
    handler: async ({ ctx, body }) => {
      if (ctx.kind === "api_key") throw new ApiError("bad_request", "Use a browser session for template instantiation");
      const id = unwrap(
        await ctx.db.rpc("project_from_template", {
          p_template_id: body.template_id, p_name: body.name, p_team_id: body.team_id ?? undefined, p_start_date: body.start_date,
        }),
      );
      return getResource(ctx, projects, id);
    },
  }),
  route({
    method: "GET",
    path: "/tasks/rollup",
    summary: "Progress roll-up at project, team and organisation level",
    tags: ["tasks"],
    module: M,
    handler: async ({ ctx }) => unwrap(await ctx.db.rpc("task_rollup", { p_org: ctx.orgId })),
  }),
  route({
    method: "GET",
    path: "/tasks/dashboard",
    summary: "Tasks overview: open, overdue, completed, trend, projects and workload, for the tasks you can see",
    tags: ["tasks"],
    module: M,
    query: z.object({ days: z.coerce.number().int().min(7).max(365).optional() }),
    handler: async ({ ctx, query }) =>
      unwrap(await ctx.db.rpc("task_dashboard", { p_org: ctx.orgId, p_days: Number(query.get("days") ?? 30) })),
  }),
  route({
    method: "GET",
    path: "/tasks/mine",
    summary: "My tasks: open ones assigned to me (default), open ones I created (view=created), or recently completed ones I created or was assigned (view=completed)",
    tags: ["tasks"],
    module: M,
    query: listParamsSchema.extend({
      status: z.string().optional(),
      due_within_days: z.coerce.number().int().optional(),
      due_date_to: z.string().optional(),
      view: z.enum(["assigned", "created", "completed"]).optional(),
    }),
    response: "list",
    handler: async ({ ctx, query }) => {
      const view = query.get("view") ?? "assigned";
      const base = Object.fromEntries([...query].filter(([k]) => k !== "view"));
      const open = (q: Query) => (query.get("status") ? q : q.not("status", "in", "(done,cancelled)"));

      if (view === "created") {
        const params = listParamsSchema.parse({ sort: "due_date", ...base });
        return listResource(ctx, tasks, params, query, (q) => open(q.eq("created_by", ctx.userId)));
      }

      if (view === "completed") {
        // completed tasks I created or was assigned, most recently completed first
        const params = listParamsSchema.parse({ ...base, sort: "-updated_at" });
        const done = (q: Query) => q.eq("status", "done");
        const [created, assigned] = await Promise.all([
          listResource(ctx, tasks, params, new URLSearchParams(), (q) => done(q.eq("created_by", ctx.userId))),
          listResource(ctx, { ...tasks, select: `${taskSelect}, mine:task_assignees!inner(user_id)` }, params, new URLSearchParams(), (q) =>
            done(q.eq("mine.user_id", ctx.userId)),
          ),
        ]);
        const byId = new Map<string, Record<string, unknown>>();
        for (const row of [...created.data, ...assigned.data]) {
          const task = { ...(row as Record<string, unknown>) };
          delete task.mine;
          byId.set(String(task.id), task);
        }
        const when = (r: Record<string, unknown>) => String(r.completed_at ?? r.updated_at ?? "");
        const data = [...byId.values()].sort((a, b) => when(b).localeCompare(when(a))).slice(0, params.limit);
        return { data, meta: { has_more: created.meta.has_more || assigned.meta.has_more, next_cursor: null, limit: params.limit } };
      }

      const spec = { ...tasks, select: `${taskSelect}, mine:task_assignees!inner(user_id)` };
      const params = listParamsSchema.parse({ sort: "due_date", ...base });
      return listResource(ctx, spec, params, query, (q) => {
        let out = q.eq("mine.user_id", ctx.userId);
        const days = query.get("due_within_days");
        if (days) out = out.lte("due_date", new Date(Date.now() + Number(days) * 86400_000).toISOString().slice(0, 10));
        return open(out);
      });
    },
  }),
  route({
    method: "GET",
    path: "/tasks/assigned/:user_id",
    summary: "Tasks assigned to a user",
    tags: ["tasks"],
    module: M,
    query: listParamsSchema,
    response: "list",
    handler: ({ ctx, params, query }) => {
      const spec = { ...tasks, select: `${taskSelect}, who:task_assignees!inner(user_id)` };
      return listResource(ctx, spec, listParamsSchema.parse(Object.fromEntries(query)), query, (q) => q.eq("who.user_id", params.user_id));
    },
  }),
  ...crudRoutes(tasks),
  route({
    method: "POST",
    path: "/tasks/:id/move",
    summary: "Move a task (board drag & drop): section, position, status",
    tags: ["tasks"],
    module: M,
    status: 200,
    body: z.object({ section_id: z.uuid().nullable().optional(), position: z.number(), status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional() }),
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("tasks").update(body).eq("id", params.id).eq("org_id", ctx.orgId).select(taskSelect).single()),
  }),
  route({
    method: "PUT",
    path: "/tasks/:id/assignees",
    summary: "Replace task assignees",
    tags: ["tasks"],
    module: M,
    status: 200,
    body: userIds,
    handler: async ({ ctx, params, body }) => {
      await getResource(ctx, tasks, params.id);
      const d = db(ctx);
      const current = unwrap(await d.from("task_assignees").select("user_id").eq("task_id", params.id)).map((r) => r.user_id);
      const remove = current.filter((u) => !body.user_ids.includes(u));
      const add = body.user_ids.filter((u) => !current.includes(u));
      if (remove.length) unwrap(await d.from("task_assignees").delete().eq("task_id", params.id).in("user_id", remove));
      if (add.length) unwrap(await d.from("task_assignees").insert(add.map((u) => ({ task_id: params.id, user_id: u, org_id: ctx.orgId }))));
      return body.user_ids;
    },
  }),
  route({
    method: "PUT",
    path: "/tasks/:id/followers",
    summary: "Replace task followers",
    tags: ["tasks"],
    module: M,
    status: 200,
    body: userIds,
    handler: async ({ ctx, params, body }) => {
      await getResource(ctx, tasks, params.id);
      const d = db(ctx);
      unwrap(await d.from("task_followers").delete().eq("task_id", params.id));
      if (body.user_ids.length) unwrap(await d.from("task_followers").insert(body.user_ids.map((u) => ({ task_id: params.id, user_id: u, org_id: ctx.orgId }))));
      return body.user_ids;
    },
  }),
  route({
    method: "POST",
    path: "/tasks/:id/follow",
    summary: "Follow or unfollow a task",
    tags: ["tasks"],
    module: M,
    status: 200,
    body: z.object({ follow: z.boolean() }),
    handler: async ({ ctx, params, body }) => {
      const d = db(ctx);
      if (body.follow) unwrap(await d.from("task_followers").upsert({ task_id: params.id, user_id: ctx.userId, org_id: ctx.orgId }));
      else unwrap(await d.from("task_followers").delete().eq("task_id", params.id).eq("user_id", ctx.userId));
      return { following: body.follow };
    },
  }),
  route({
    method: "PUT",
    path: "/tasks/:id/dependencies",
    summary: "Replace the tasks this task depends on (cycles are rejected)",
    tags: ["tasks"],
    module: M,
    status: 200,
    body: z.object({ depends_on: z.array(z.uuid()).max(50) }),
    handler: async ({ ctx, params, body }) => {
      const d = db(ctx);
      unwrap(await d.from("task_dependencies").delete().eq("task_id", params.id));
      if (body.depends_on.length)
        unwrap(await d.from("task_dependencies").insert(body.depends_on.map((x) => ({ task_id: params.id, depends_on_task_id: x, org_id: ctx.orgId }))));
      return body.depends_on;
    },
  }),
  route({
    method: "POST",
    path: "/tasks/:id/links",
    summary: "Link a task to an issue, work order, PO, requisition, asset, vendor or claim",
    tags: ["tasks"],
    module: M,
    body: z.object({
      entity_type: z.enum(["issue", "work_order", "purchase_order", "requisition", "asset", "vendor", "expense_claim"]),
      entity_id: z.uuid(),
    }),
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("task_links").insert({ ...body, task_id: params.id, org_id: ctx.orgId }).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/tasks/:id/links/:linkId",
    summary: "Remove a task link",
    tags: ["tasks"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await db(ctx).from("task_links").delete().eq("id", params.linkId).eq("task_id", params.id));
    },
  }),
  route({
    method: "GET",
    path: "/task-links",
    summary: "Tasks linked to an entity",
    tags: ["tasks"],
    module: M,
    query: z.object({ entity_type: z.string(), entity_id: z.uuid() }),
    handler: async ({ ctx, query }) =>
      unwrap(
        await ctx.db
          .from("task_links")
          .select("id, task:tasks(id, title, status, due_date, assignees:task_assignees(profile:profiles(id, full_name)))")
          .eq("entity_type", query.get("entity_type")!)
          .eq("entity_id", query.get("entity_id")!),
      ),
  }),
  ...crudRoutes(taskTemplates, { tag: "tasks", ops: ["list", "get", "create", "update", "delete"] }),
  route({
    method: "POST",
    path: "/task-templates/:id/instantiate",
    summary: "Create a task (with subtasks) from a template",
    tags: ["tasks"],
    module: M,
    body: z.object({ project_id: optUuid, section_id: optUuid, start: isoDate.optional() }),
    handler: async ({ ctx, params, body }) => {
      if (ctx.kind === "api_key") throw new ApiError("bad_request", "Use a browser session for template instantiation");
      const id = unwrap(
        await ctx.db.rpc("task_from_template", {
          p_template_id: params.id, p_project_id: body.project_id ?? undefined, p_section_id: body.section_id ?? undefined, p_start: body.start,
        }),
      );
      return getResource(ctx, tasks, id);
    },
  }),
];
