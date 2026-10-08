import { PageHeader, Stat } from "@/components/shared/page-header";
import { getSessionContext } from "@/lib/auth/context";
import { requireSession } from "@/lib/auth/session-data";
import { unwrap } from "@/lib/api/errors";
import { hasApprovals } from "@/lib/nav";
import { getT } from "@/lib/i18n/server";
import { HomeWidgets } from "./home-widgets";
import { PendingSurvey } from "./pending-survey";

// "Dr. Kavita Rao" → "Kavita", "Anita Sharma" → "Anita"
function firstName(full: string | null | undefined) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  const name = parts.find((p) => !/^(dr|mr|mrs|ms|prof|shri|smt|sri)\.?$/i.test(p));
  return name ?? parts[0] ?? null;
}

export const metadata = { title: "Home" };

export default async function HomePage() {
  // the dashboard numbers load alongside the app shell's data, not after it
  const early = await getSessionContext();
  const [{ ctx, data }, dash] = await Promise.all([requireSession(), early ? early.db.rpc("home_dashboard", { p_org: early.orgId }) : null]);
  const stats = (dash ? unwrap(dash) : unwrap(await ctx.db.rpc("home_dashboard", { p_org: ctx.orgId }))) as Record<string, number>;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: ctx.org.timezone }).format(new Date()));
  const { t } = await getT();
  const greeting = hour < 12 ? "home.morning" : hour < 17 ? "home.afternoon" : "home.evening";
  const m = new Set(data.modules);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t(greeting, { name: firstName(data.user.full_name) ?? t("home.there") })} description={ctx.org.name} />
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
      <PendingSurvey />
      <HomeWidgets />
    </div>
  );
}
