import { Suspense } from "react";
import { ProjectView } from "./project-view";

export const metadata = { title: "Project" };

export default async function ProjectPage(props: PageProps<"/tasks/projects/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense>
      <ProjectView id={id} />
    </Suspense>
  );
}
