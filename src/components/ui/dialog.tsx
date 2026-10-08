"use client";
import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  wide,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { wide?: boolean }) {
  const { t } = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 grid max-h-[92dvh] w-full gap-4 overflow-y-auto border bg-popover p-5 shadow-xl data-[state=open]:animate-in",
          "inset-x-0 bottom-0 rounded-t-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <XIcon className="size-4" />
          <span className="sr-only">{t("ui.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 pr-6", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Right-hand drawer (task details, filters on mobile). */
export function SheetContent({ className, children, side = "right", ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: "right" | "left" }) {
  const { t } = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-full flex-col overflow-y-auto border-l bg-background shadow-xl data-[state=open]:animate-in sm:max-w-xl",
          side === "right" ? "right-0" : "left-0 border-r border-l-0 sm:max-w-xs",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-muted">
          <XIcon className="size-4" />
          <span className="sr-only">{t("ui.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
