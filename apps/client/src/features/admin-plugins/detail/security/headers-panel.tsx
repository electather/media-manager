import { useState } from "react";
import { PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { PLUGIN_ADMIN_HEADERS_MAX } from "@nama/shared/plugins";

import { m } from "@/paraglide/messages";

import { Button } from "@/shared/ui/button";

import { HeaderDialog, type HeaderDialogState } from "./header-dialog";
import { useDeleteAdminHeader } from "../use-admin-headers";
import type { PluginRow } from "../../shared/types";

interface HeadersPanelProps {
  plugin: PluginRow;
}

export function HeadersPanel({ plugin }: HeadersPanelProps) {
  const [dialog, setDialog] = useState<HeaderDialogState>({ kind: "none" });
  const del = useDeleteAdminHeader(plugin.id);
  const headers = plugin.advanced.adminHeaderNames;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{m.admin_plugins_headers_title()}</h3>
          <p className="text-xs text-muted-foreground">
            {m.admin_plugins_headers_description({ name: plugin.manifest.name })}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ kind: "add" })}
          disabled={headers.length >= PLUGIN_ADMIN_HEADERS_MAX}
        >
          <PlusIcon /> {m.admin_plugins_headers_add()}
        </Button>
      </header>
      {headers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{m.admin_plugins_headers_empty()}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border text-xs">
          {headers.map((name) => (
            <div key={name} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-mono">{name}</span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialog({ kind: "edit", name })}
                  aria-label={m.admin_plugins_headers_edit_aria({ name })}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => del.mutate(name)}
                  aria-label={m.admin_plugins_headers_delete_aria({ name })}
                  disabled={del.isPending}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <HeaderDialog
        pluginId={plugin.id}
        state={dialog}
        onClose={() => setDialog({ kind: "none" })}
      />
    </section>
  );
}
