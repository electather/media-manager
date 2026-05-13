import { useState } from "react";
import { BellIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Drawer, DrawerContent } from "@/shared/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { BellPopoverShell } from "./bell-popover-shell";
import { useUnreadCount } from "./use-unread-count";
import type { Density, Intensity } from "../shared/types";

interface Props {
  density?: Density;
  intensity?: Intensity;
}

export function bellAriaLabel(unreadCount: number): string {
  return unreadCount > 0
    ? m.notifications_bell_aria_unread({ count: unreadCount })
    : m.notifications_title();
}

function BellTriggerContent({ unreadCount }: { unreadCount: number }) {
  return (
    <>
      <BellIcon className="size-4" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
        />
      )}
    </>
  );
}

export function NotificationBell({ density = "comfortable", intensity = "subtle" }: Props) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data } = useUnreadCount();
  const unreadCount = data?.count ?? 0;

  if (isMobile) {
    return (
      <>
        <Button
          aria-label={bellAriaLabel(unreadCount)}
          onClick={() => setOpen(true)}
          className={cn("relative")}
          variant="outline"
          size="icon-sm"
        >
          <BellTriggerContent unreadCount={unreadCount} />
        </Button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="h-[75dvh] gap-0 p-0">
            <BellPopoverShell
              density={density}
              intensity={intensity}
              unreadCount={unreadCount}
              mobile
            />
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={bellAriaLabel(unreadCount)}
        className={cn("relative")}
        render={<Button variant="outline" size="icon-sm" />}
      >
        <BellTriggerContent unreadCount={unreadCount} />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="flex h-[min(640px,calc(100dvh-80px))] w-100 flex-col overflow-hidden p-0"
        aria-label={m.notifications_title()}
      >
        <BellPopoverShell density={density} intensity={intensity} unreadCount={unreadCount} />
      </PopoverContent>
    </Popover>
  );
}
