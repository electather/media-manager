import { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { m } from "@/paraglide/messages";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Field, FieldDescription, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sandboxAvailable?: boolean;
}

export function InstallDialog({
  open,
  onOpenChange,
  sandboxAvailable = false,
}: InstallDialogProps) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!open) setUrl("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.admin_plugins_install_dialog_title()}</DialogTitle>
          <DialogDescription>{m.admin_plugins_install_dialog_description()}</DialogDescription>
        </DialogHeader>
        {!sandboxAvailable ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
            <div>
              <strong className="font-medium">
                {m.admin_plugins_install_dialog_sandbox_unavailable()}
              </strong>{" "}
              {m.admin_plugins_install_dialog_sandbox_note()}
            </div>
          </div>
        ) : null}
        <Field>
          <FieldTitle>{m.admin_plugins_install_dialog_field_title()}</FieldTitle>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/plugin.json"
            disabled={!sandboxAvailable}
            autoComplete="off"
          />
          <FieldDescription>{m.admin_plugins_install_dialog_field_hint()}</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.admin_plugins_install_dialog_cancel()}
          </Button>
          {/* TODO: wire install mutation once third-party plugin installs ship. */}
          <Button disabled={!sandboxAvailable || url.trim().length === 0}>
            {m.admin_plugins_install_dialog_install()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
