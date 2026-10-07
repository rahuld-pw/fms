import { PageHeader, Stat } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth/session-data";
import { unwrap } from "@/lib/api/errors";
import { HomeWidgets } from "./home-widgets";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { ctx, data } = await requireSession();
  const stats = unwrap(await ctx.db.rpc("home_dashboard", { p_org: ctx.orgId })) as Record<string, number>;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: ctx.org.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const m = new Set(data.modules);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`${greeting}, ${data.user.full_name?.split(" ")[0] ?? "there"}`} description={ctx.org.name} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for my approval" value={stats.my_approvals ?? 0} href="/approvals" tone={stats.my_approvals ? "warning" : "default"} />
        {m.has("tasks") && (
          <Stat
            label="My open tasks"
            value={stats.my_tasks_open ?? 0}
            hint={stats.my_tasks_overdue ? `${stats.my_tasks_overdue} overdue` : `${stats.my_tasks_due_soon ?? 0} due in 3 days`}
            tone={stats.my_tasks_overdue ? "danger" : "default"}
            href="/tasks"
          />
        )}
        {m.has("facility") && (
          <Stat label="My open issues & work orders" value={(stats.my_issues_open ?? 0) + (stats.my_work_orders_open ?? 0)} href="/facility/issues?assignee_id=me" />
        )}
        {m.has("expense") && <Stat label="My claims in progress" value={stats.my_claims_pending ?? 0} href="/expense/claims?claimant_id=me" />}
      </div>
      <HomeWidgets />
    </div>
  );
}
