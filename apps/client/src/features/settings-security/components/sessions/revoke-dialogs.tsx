import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { parseUserAgent } from "@/shared/lib/user-agent";
import { m } from "@/paraglide/messages";

import type { DisplaySession } from "../../lib/types";

export function RevokeSessionDialog({
  session,
  onClose,
  onConfirm,
}: {
  session: DisplaySession | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!session}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_security_revoke_dialog_title()}</DialogTitle>
          <DialogDescription>
            {session
              ? m.settings_security_revoke_dialog_body({
                  device: parseUserAgent(session.userAgent ?? null).label,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_security_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke">
            {m.settings_security_revoke_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeAllSessionsDialog({
  open,
  count,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_security_revoke_all_dialog_title()}</DialogTitle>
          <DialogDescription>
            {m.settings_security_revoke_all_dialog_body({ count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_security_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-all">
            {m.settings_security_revoke_all_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
