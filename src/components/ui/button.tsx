"use client";
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border bg-background shadow-xs hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5 text-[13px]",
        xs: "h-7 px-2 text-xs",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

/**
 * `loading` shows a spinner and disables the button. When `onClick` returns a
 * promise the button does the same by itself until it settles, so async
 * actions can't be triggered twice by double clicks.
 */
export function Button({ className, variant, size, asChild, loading, disabled, children, onClick, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const [pending, setPending] = React.useState(false);
  const busy = !!loading || pending;
  const handleClick = onClick
    ? (e: React.MouseEvent<HTMLButtonElement>) => {
        if (busy) return e.preventDefault();
        const result = (onClick as (e: React.MouseEvent<HTMLButtonElement>) => unknown)(e);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          setPending(true);
          (result as Promise<unknown>).finally(() => setPending(false)).catch(() => undefined);
        }
      }
    : undefined;
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}
