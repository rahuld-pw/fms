import { TaskDetail } from "./task-detail";

export const metadata = { title: "Task" };

export default async function TaskPage(props: PageProps<"/tasks/t/[id]">) {
  const { id } = await props.params;
  return <TaskDetail id={id} />;
}
