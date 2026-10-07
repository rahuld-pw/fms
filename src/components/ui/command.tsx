"use client";
import * as React from "react";
import { Command as C } from "cmdk";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Command({ className, ...props }: React.ComponentProps<typeof C>) {
  return <C className={cn("flex size-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground", className)} {...props} />;
}
export function CommandInput({ className, ...props }: React.ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <C.Input className={cn("flex h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground", className)} {...props} />
    </div>
  );
}
export function CommandList({ className, ...props }: React.ComponentProps<typeof C.List>) {
  return <C.List className={cn("max-h-[60dvh] overflow-y-auto p-1 scrollbar-thin", className)} {...props} />;
}
export function CommandEmpty(props: React.ComponentProps<typeof C.Empty>) {
  return <C.Empty className="py-6 text-center text-sm text-muted-foreground" {...props} />;
}
export function CommandGroup({ className, ...props }: React.ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn("overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground", className)}
      {...props}
    />
  );
}
export function CommandItem({ className, ...props }: React.ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn("relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground", className)}
      {...props}
    />
  );
}
