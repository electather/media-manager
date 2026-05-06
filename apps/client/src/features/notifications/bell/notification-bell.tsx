import { useState } from "react";
import { BellIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Drawer, DrawerContent } from "@/shared/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { m } from "@/paraglide/messages";
import { BellPopoverShell } from "./bell-popover-shell";
import { DUMMY_NOTIFICATIONS } from "./__fixtures__/popover-fixtures";
import type { Density, Intensity, NotificationItemDto } from "../shared/types";
import { cn } from "@/shared/lib/utils";

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
  const [items, setItems] = useState<NotificationItemDto[]>(DUMMY_NOTIFICATIONS);
  const isMobile = useIsMobile();

  const unreadCount = items.filter((i) => i.readAt === null).length;

  const markRead = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: Date.now() } : i)));

  const markAllRead = () =>
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? Date.now() })));

  const dismiss = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const body = (
    <BellPopoverShell
      items={items}
      density={density}
      intensity={intensity}
      onMarkAllRead={markAllRead}
      onMarkRead={markRead}
      onDismiss={dismiss}
    />
  );

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
              items={items}
              density={density}
              intensity={intensity}
              mobile
              onMarkAllRead={markAllRead}
              onMarkRead={markRead}
              onDismiss={dismiss}
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
        className="flex w-100 max-h-[min(640px,calc(100dvh-80px))] flex-col overflow-hidden p-0"
        aria-label={m.notifications_title()}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}
