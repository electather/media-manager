import { useEffect, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";

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

import { useUninstallPlugin } from "./use-uninstall-plugin";
import type { PluginRow } from "../shared/types";

interface UninstallDialogProps {
  plugin: PluginRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UninstallDialog({ plugin, open, onOpenChange }: UninstallDialogProps) {
  const [typed, setTyped] = useState("");
  const uninstall = useUninstallPlugin();
  const pending = uninstall.isPending;
  const match = typed.trim() === plugin.manifest.name;

  useEffect(() => {
    if (!open) {
      setTyped("");
      uninstall.reset();
    }
  }, [open, uninstall]);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="gap-0 p-0 sm:max-w-[28rem]">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-destructive">Uninstall {plugin.manifest.name}?</DialogTitle>
          <DialogDescription>
            This removes the plugin and deletes every user connection associated with it. Data on
            the external service is not affected. To confirm, type{" "}
            <strong className="font-medium text-foreground">{plugin.manifest.name}</strong> below.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4">
          <Field>
            <FieldTitle>Plugin name</FieldTitle>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={plugin.manifest.name}
              disabled={pending}
            />
            <FieldDescription>Must match exactly.</FieldDescription>
          </Field>
          {uninstall.error ? (
            <p className="mt-3 text-sm text-destructive">{uninstall.error.message}</p>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => uninstall.mutate(plugin.id)}
            disabled={!match || pending}
          >
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Uninstall plugin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
