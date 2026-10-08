import { TaskDetail } from "./task-detail";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("tasks.detail.pageTitle") };
}

export default async function TaskPage(props: PageProps<"/tasks/t/[id]">) {
  const { id } = await props.params;
  return <TaskDetail id={id} />;
}
