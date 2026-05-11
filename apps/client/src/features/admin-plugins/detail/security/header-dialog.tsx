import { useEffect, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { PLUGIN_RESERVED_HEADER_NAMES } from "@ent-mcp/shared/plugins";

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

import { useUpsertAdminHeader } from "../use-admin-headers";

const HEADER_NAME_PATTERN = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

export type HeaderDialogState = { kind: "none" } | { kind: "add" } | { kind: "edit"; name: string };

interface HeaderDialogProps {
  pluginId: string;
  state: HeaderDialogState;
  onClose: () => void;
}

// fallow-ignore-next-line complexity
export function HeaderDialog({ pluginId, state, onClose }: HeaderDialogProps) {
  const open = state.kind !== "none";
  const isEdit = state.kind === "edit";
  const initialName = state.kind === "edit" ? state.name : "";

  const [name, setName] = useState(initialName);
  const [value, setValue] = useState("");
  const [preserveValue, setPreserveValue] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertAdminHeader(pluginId);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setValue("");
    setPreserveValue(isEdit);
    setError(null);
    upsert.reset();
  }, [open, initialName, isEdit, upsert.reset]);

  // fallow-ignore-next-line complexity
  const save = () => {
    setError(null);
    if (!HEADER_NAME_PATTERN.test(name)) {
      setError(m.admin_plugins_header_dialog_error_invalid_name());
      return;
    }
    if ((PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(name.toLowerCase())) {
      setError(m.admin_plugins_header_dialog_error_reserved());
      return;
    }
    if (isEdit && preserveValue) {
      onClose();
      return;
    }
    if (!value) {
      setError(m.admin_plugins_header_dialog_error_empty_value());
      return;
    }
    if (/[\r\n]/.test(value)) {
      setError(m.admin_plugins_header_dialog_error_crlf());
      return;
    }
    upsert.mutate(
      { name, value },
      {
        onSuccess: () => onClose(),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? m.admin_plugins_header_dialog_title_edit({ name: initialName })
              : m.admin_plugins_header_dialog_title_add()}
          </DialogTitle>
          <DialogDescription>{m.admin_plugins_header_dialog_description()}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldTitle>{m.admin_plugins_header_dialog_field_name()}</FieldTitle>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={isEdit}
              placeholder="X-Corp-Key"
            />
            {isEdit ? (
              <FieldDescription>
                {m.admin_plugins_header_dialog_field_name_rename_hint()}
              </FieldDescription>
            ) : null}
          </Field>
          {isEdit ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={preserveValue}
                onChange={(e) => setPreserveValue(e.target.checked)}
              />
              {m.admin_plugins_header_dialog_preserve()}
            </label>
          ) : null}
          {!preserveValue ? (
            <Field>
              <FieldTitle>{m.admin_plugins_header_dialog_field_value()}</FieldTitle>
              <Input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
              />
            </Field>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={upsert.isPending}>
            {m.admin_plugins_header_dialog_cancel()}
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            {m.admin_plugins_header_dialog_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
