import { Suspense } from "react";
import { ProjectView } from "./project-view";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("tasks.projects.pageTitle") };
}

export default async function ProjectPage(props: PageProps<"/tasks/projects/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense>
      <ProjectView id={id} />
    </Suspense>
  );
}
