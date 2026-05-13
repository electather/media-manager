import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { m } from "@/paraglide/messages";

export function RevokeOneDialog({
  app,
  onCancel,
  onConfirm,
}: {
  app: AuthorizedApp | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!app}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {app ? m.settings_apps_revoke_dialog_title({ name: app.name }) : ""}
          </DialogTitle>
          <DialogDescription>{m.settings_apps_revoke_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-app">
            {m.settings_apps_revoke_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeAllDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title =
    count === 1
      ? m.settings_apps_revoke_all_dialog_title_singular({ count })
      : m.settings_apps_revoke_all_dialog_title_plural({ count });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{m.settings_apps_revoke_all_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-all">
            {m.settings_apps_revoke_all_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
