import { CheckIcon } from "lucide-react";

import { m } from "@/paraglide/messages";

import type { PluginSummary } from "../lib/types";

export function ConnectionModalDone({ plugin }: { plugin: PluginSummary }) {
  return (
    <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-success/40 bg-success/15 text-success">
        <CheckIcon className="size-6" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-medium text-foreground">
          {m.settings_connections_modal_done_title({ name: plugin.name })}
        </p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {m.settings_connections_modal_done_body()}
        </p>
      </div>
    </div>
  );
}
