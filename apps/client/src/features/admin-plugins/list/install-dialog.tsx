import { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

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
          <DialogTitle>Install plugin from URL</DialogTitle>
          <DialogDescription>
            Paste a manifest URL. Built-in plugins register on server boot; third-party plugin
            installs ship in a later version.
          </DialogDescription>
        </DialogHeader>
        {!sandboxAvailable ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
            <div>
              <strong className="font-medium">Sandbox unavailable.</strong> Remote install is
              disabled until the QuickJS sandbox is running.
            </div>
          </div>
        ) : null}
        <Field>
          <FieldTitle>Manifest URL</FieldTitle>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/plugin.json"
            disabled={!sandboxAvailable}
            autoComplete="off"
          />
          <FieldDescription>
            Drop the plugin's <code className="font-mono">plugin.json</code> URL — relative asset
            paths resolve from it.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* TODO: wire install mutation once third-party plugin installs ship. */}
          <Button disabled={!sandboxAvailable || url.trim().length === 0}>
            Verify &amp; install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
