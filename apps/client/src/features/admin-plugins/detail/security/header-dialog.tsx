import { useEffect, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { PLUGIN_RESERVED_HEADER_NAMES } from "@ent-mcp/shared/plugins";

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
  }, [open, initialName, isEdit, upsert]);

  const save = () => {
    setError(null);
    if (!HEADER_NAME_PATTERN.test(name)) {
      setError("Invalid header name — use RFC 7230 token characters only.");
      return;
    }
    if ((PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(name.toLowerCase())) {
      setError("Header is reserved by the runtime.");
      return;
    }
    if (isEdit && preserveValue) {
      onClose();
      return;
    }
    if (!value) {
      setError("Value cannot be empty — use the delete action to remove.");
      return;
    }
    if (/[\r\n]/.test(value)) {
      setError("Value contains CR/LF.");
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
          <DialogTitle>{isEdit ? `Edit header ${initialName}` : "Add header"}</DialogTitle>
          <DialogDescription>
            Values are stored encrypted on the server and never displayed after save.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldTitle>Name</FieldTitle>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={isEdit}
              placeholder="X-Corp-Key"
            />
            {isEdit ? (
              <FieldDescription>To rename a header, delete and re-add it.</FieldDescription>
            ) : null}
          </Field>
          {isEdit ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={preserveValue}
                onChange={(e) => setPreserveValue(e.target.checked)}
              />
              Preserve existing value
            </label>
          ) : null}
          {!preserveValue ? (
            <Field>
              <FieldTitle>Value</FieldTitle>
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
            Cancel
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
