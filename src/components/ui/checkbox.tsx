"use client";
import * as React from "react";
import { Checkbox as C, Switch as S } from "radix-ui";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "peer hit-area size-4 shrink-0 rounded-[4px] border border-input shadow-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <C.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3.5" />
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "peer hit-area inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </S.Root>
  );
}
