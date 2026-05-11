import { useEffect, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";

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
          <DialogTitle className="text-destructive">
            {m.admin_plugins_uninstall_title({ name: plugin.manifest.name })}
          </DialogTitle>
          <DialogDescription>
            {m.admin_plugins_uninstall_description({ name: plugin.manifest.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4">
          <Field>
            <FieldTitle>{m.admin_plugins_uninstall_field_title()}</FieldTitle>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={plugin.manifest.name}
              disabled={pending}
            />
            <FieldDescription>{m.admin_plugins_uninstall_field_hint()}</FieldDescription>
          </Field>
          {uninstall.error ? (
            <p className="mt-3 text-sm text-destructive">{uninstall.error.message}</p>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {m.admin_plugins_uninstall_cancel()}
          </Button>
          <Button
            variant="destructive"
            onClick={() => uninstall.mutate(plugin.id)}
            disabled={!match || pending}
          >
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            {m.admin_plugins_uninstall_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
