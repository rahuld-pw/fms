import { PageHeader, Stat } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth/session-data";
import { unwrap } from "@/lib/api/errors";
import { hasApprovals } from "@/lib/nav";
import { getT } from "@/lib/i18n/server";
import { HomeWidgets } from "./home-widgets";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { ctx, data } = await requireSession();
  const stats = unwrap(await ctx.db.rpc("home_dashboard", { p_org: ctx.orgId })) as Record<string, number>;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: ctx.org.timezone }).format(new Date()));
  const { t } = await getT();
  const greeting = hour < 12 ? "home.morning" : hour < 17 ? "home.afternoon" : "home.evening";
  const m = new Set(data.modules);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t(greeting, { name: data.user.full_name?.split(" ")[0] ?? t("home.there") })} description={ctx.org.name} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hasApprovals(data.modules) && (
          <Stat label={t("home.waitingApproval")} value={stats.my_approvals ?? 0} href="/approvals" tone={stats.my_approvals ? "warning" : "default"} />
        )}
        {m.has("tasks") && (
          <Stat
            label={t("home.myOpenTasks")}
            value={stats.my_tasks_open ?? 0}
            hint={stats.my_tasks_overdue ? t("home.overdueN", { n: stats.my_tasks_overdue }) : t("home.dueSoonN", { n: stats.my_tasks_due_soon ?? 0 })}
            tone={stats.my_tasks_overdue ? "danger" : "default"}
            href="/tasks"
          />
        )}
        {m.has("facility") && (
          <Stat label={t("home.myIssues")} value={(stats.my_issues_open ?? 0) + (stats.my_work_orders_open ?? 0)} href="/facility/issues?assignee_id=me" />
        )}
        {m.has("expense") && <Stat label={t("home.myClaims")} value={stats.my_claims_pending ?? 0} href="/expense/claims?claimant_id=me" />}
      </div>
      <HomeWidgets />
    </div>
  );
}
