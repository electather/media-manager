import { Button } from "@/shared/ui/button";
import { Bell } from "lucide-react";

export function NotificationPanel() {
  return (
    <Button aria-label="Notifications" size="icon-sm" variant="outline" className="cursor-pointer">
      <Bell className="size-4" />
    </Button>
  );
}
