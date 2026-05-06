import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { m } from "@/paraglide/messages";
import { useAdminSettings } from "./use-admin-settings";
import { useUpdateAdminSettings } from "./use-update-admin-settings";

export function RetentionForm() {
  const { data } = useAdminSettings();
  const update = useUpdateAdminSettings();
  const [inbox, setInbox] = useState(String(data.inboxRetentionDays));
  const [delivery, setDelivery] = useState(String(data.deliveryRetentionDays));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({
      inboxRetentionDays: Number(inbox),
      deliveryRetentionDays: Number(delivery),
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="inbox-retention">{m.notifications_admin_settings_inbox_retention()}</Label>
        <Input
          id="inbox-retention"
          type="number"
          min={1}
          max={3650}
          value={inbox}
          onChange={(e) => setInbox(e.target.value)}
          className="w-32"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="delivery-retention">
          {m.notifications_admin_settings_delivery_retention()}
        </Label>
        <Input
          id="delivery-retention"
          type="number"
          min={1}
          max={3650}
          value={delivery}
          onChange={(e) => setDelivery(e.target.value)}
          className="w-32"
        />
      </div>
      <div>
        <Button type="submit" disabled={update.isPending}>
          {m.notifications_admin_settings_save()}
        </Button>
      </div>
    </form>
  );
}
