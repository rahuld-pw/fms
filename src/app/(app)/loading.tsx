import { Skeleton } from "@/components/ui/skeleton";

/** Shown instantly while a screen loads, so navigation never looks frozen. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
    </div>
  );
}
