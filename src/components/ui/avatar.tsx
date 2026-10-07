import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

const COLORS = ["bg-emerald-600", "bg-sky-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600"];

export function Avatar({ name, className, size = "md" }: { name?: string | null; className?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const hash = (name ?? "?").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      title={name ?? undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none",
        COLORS[hash % COLORS.length],
        { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" }[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: (string | null | undefined)[]; max?: number }) {
  return (
    <span className="flex -space-x-1.5">
      {names.slice(0, max).map((n, i) => (
        <Avatar key={i} name={n} size="sm" className="ring-2 ring-background" />
      ))}
      {names.length > max && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
          +{names.length - max}
        </span>
      )}
    </span>
  );
}
