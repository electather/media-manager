import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { m } from "@/paraglide/messages";
import { useAdminSettings } from "./use-admin-settings";
import { useUpdateAdminSettings } from "./use-update-admin-settings";

/** Returns true only for valid integer values within the allowed retention range [1, 3650]. */
function isValidRetentionDays(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 3650;
}

export function RetentionForm() {
  const { data } = useAdminSettings();
  const update = useUpdateAdminSettings();
  const [inbox, setInbox] = useState(String(data.inboxRetentionDays));
  const [delivery, setDelivery] = useState(String(data.deliveryRetentionDays));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const inboxDays = Number(inbox);
        const deliveryDays = Number(delivery);
        if (!isValidRetentionDays(inboxDays) || !isValidRetentionDays(deliveryDays)) {
          return;
        }
        update.mutate(
          {
            inboxRetentionDays: inboxDays,
            deliveryRetentionDays: deliveryDays,
          },
          {
            // Sync local input state to the server-authoritative values so the
            // form reflects any clamping or normalization the server applied.
            onSuccess: (response) => {
              setInbox(String(response.inboxRetentionDays));
              setDelivery(String(response.deliveryRetentionDays));
            },
          },
        );
      }}
      className="flex flex-col gap-4"
    >
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
