import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-muted text-muted-foreground",
        green: "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
        blue: "border-transparent bg-sky-500/12 text-sky-700 dark:text-sky-300",
        amber: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
        red: "border-transparent bg-red-500/12 text-red-700 dark:text-red-300",
        violet: "border-transparent bg-violet-500/12 text-violet-700 dark:text-violet-300",
        outline: "bg-transparent text-foreground",
        primary: "border-transparent bg-primary text-primary-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
