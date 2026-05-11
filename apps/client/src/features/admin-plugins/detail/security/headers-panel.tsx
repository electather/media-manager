import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { PLUGIN_ADMIN_HEADERS_MAX } from "@ent-mcp/shared/plugins";

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
          <h3 className="text-sm font-medium">Custom request headers</h3>
          <p className="text-xs text-muted-foreground">
            Injected into every request {plugin.manifest.name} makes. Admin values override
            plugin-supplied headers on conflict. Values are encrypted on the server and never
            returned.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ kind: "add" })}
          disabled={headers.length >= PLUGIN_ADMIN_HEADERS_MAX}
        >
          <PlusIcon /> Add header
        </Button>
      </header>
      {headers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No custom headers configured.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-1.5 font-normal">Name</th>
                <th className="px-3 py-1.5 font-normal">Value</th>
                <th className="w-28 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {headers.map((name) => (
                <tr key={name} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-2 font-mono">{name}</td>
                  <td className="px-3 py-2 text-muted-foreground">••••</td>
                  <td className="py-1.5 pr-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ kind: "edit", name })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => del.mutate(name)}
                      aria-label={`Delete ${name}`}
                      disabled={del.isPending}
                    >
                      <XIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
