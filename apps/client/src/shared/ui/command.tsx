import { Command as CommandPrimitive } from "cmdk";
import * as React from "react";

import { cn } from "@/shared/lib/utils";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[min(420px,60vh)] scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-8 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground",
        "**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5",
        "**:[[cmdk-group-heading]]:font-mono **:[[cmdk-group-heading]]:text-[11px]",
        "**:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:uppercase",
        "**:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-muted-foreground/60",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px w-auto bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm",
        "outline-hidden select-none transition-colors",
        "text-muted-foreground",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        // cmdk sets `data-selected` on every item ("true" | "false") —
        // require the explicit truthy value or the styling leaks onto every
        // row instead of only the active one.
        "data-[selected=true]:bg-accent data-[selected=true]:text-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-[selected=true]:**:[svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {/* Active row accent rail. Hidden by default, revealed when the item is
          selected. We rely on the start-* logical property so the rail sits on
          the inline-start edge in both LTR and RTL. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2 start-0 hidden w-0.5 rounded-full bg-primary group-data-[selected=true]/command-item:block"
      />
      {children}
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ms-auto text-xs tracking-widest text-muted-foreground",
        "group-data-[selected=true]/command-item:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
