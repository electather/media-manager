import { m } from "@/paraglide/messages";
import { FieldDescription } from "@/shared/ui/field";

import type { PluginSummary } from "../lib/types";

interface IntroProps {
  plugin: PluginSummary;
  /** Pre-translated body copy. */
  body: string;
}

export function OauthIntro({ plugin, body }: IntroProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm">
      <p className="text-foreground">
        <strong className="font-medium">
          {m.settings_connections_modal_oauth_header({ name: plugin.name })}
        </strong>
      </p>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}

export function OauthEditNotice({ plugin }: { plugin: PluginSummary }) {
  return (
    <FieldDescription>
      {m.settings_connections_modal_oauth_edit_notice({ name: plugin.name })}
    </FieldDescription>
  );
}
