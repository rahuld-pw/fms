import { cn } from "@/lib/utils/cn";

/** Same spinner markup as `<Button loading>`, for plain buttons and menu items. */
export function Spinner({ className }: { className?: string }) {
  return <span className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-hidden />;
}
