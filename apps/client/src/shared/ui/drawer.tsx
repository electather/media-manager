"use client";

import { Drawer } from "@base-ui/react/drawer";

import { cn } from "@/shared/lib/utils";

function DrawerRoot({ ...props }: React.ComponentProps<typeof Drawer.Root>) {
  return <Drawer.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof Drawer.Trigger>) {
  return <Drawer.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof Drawer.Portal>) {
  return <Drawer.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: React.ComponentProps<typeof Drawer.Close>) {
  return <Drawer.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof Drawer.Backdrop>) {
  return (
    <Drawer.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-300 ease-out supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Drawer.Popup>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <Drawer.Viewport className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
        <Drawer.Popup
          data-slot="drawer-content"
          className={cn(
            "group/drawer-content pointer-events-auto absolute flex h-auto flex-col bg-popover text-sm text-popover-foreground duration-300 ease-out data-open:animate-in data-closed:animate-out",
            "data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:mt-24 data-[swipe-direction=down]:max-h-[80vh] data-[swipe-direction=down]:rounded-t-xl data-[swipe-direction=down]:border-t data-[swipe-direction=down]:data-open:slide-in-from-bottom data-[swipe-direction=down]:data-closed:slide-out-to-bottom",
            "data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:right-0 data-[swipe-direction=left]:w-3/4 data-[swipe-direction=left]:rounded-l-xl data-[swipe-direction=left]:border-l data-[swipe-direction=left]:sm:max-w-sm data-[swipe-direction=left]:data-open:slide-in-from-right data-[swipe-direction=left]:data-closed:slide-out-to-right",
            "data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:left-0 data-[swipe-direction=right]:w-3/4 data-[swipe-direction=right]:rounded-r-xl data-[swipe-direction=right]:border-r data-[swipe-direction=right]:sm:max-w-sm data-[swipe-direction=right]:data-open:slide-in-from-left data-[swipe-direction=right]:data-closed:slide-out-to-left",
            "data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:mb-24 data-[swipe-direction=up]:max-h-[80vh] data-[swipe-direction=up]:rounded-b-xl data-[swipe-direction=up]:border-b data-[swipe-direction=up]:data-open:slide-in-from-top data-[swipe-direction=up]:data-closed:slide-out-to-top",
            className,
          )}
          {...props}
        >
          <div className="absolute top-3 left-1/2 z-10 hidden h-1.5 w-25 -translate-x-1/2 rounded-full bg-foreground/40 group-data-[swipe-direction=down]/drawer-content:block" />
          <Drawer.Content className="flex-1 min-h-0 overflow-hidden">{children}</Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[swipe-direction=down]/drawer-content:text-center group-data-[swipe-direction=up]/drawer-content:text-center md:gap-1.5 md:text-start",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof Drawer.Title>) {
  return (
    <Drawer.Title
      data-slot="drawer-title"
      className={cn("font-heading font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof Drawer.Description>) {
  return (
    <Drawer.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  DrawerRoot as Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
