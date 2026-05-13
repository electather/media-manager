import { LayersIcon } from "lucide-react";

import { m } from "@/paraglide/messages";

export function AppsEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <LayersIcon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{m.settings_apps_empty_title()}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {m.settings_apps_empty_description()}
        </p>
      </div>
    </div>
  );
}
