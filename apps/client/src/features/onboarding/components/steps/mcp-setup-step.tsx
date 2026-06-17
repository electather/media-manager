import { useState } from "react";
import { PlugIcon } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/components/copy-button";
import { SetupGuideModal } from "@/features/settings-apps";
import { publicConfigQueryOptions } from "../../lib/queries";

/**
 * MCP setup onboarding step. Guides the admin through connecting an AI client
 * (Claude Desktop, Cursor, etc.) to the instance's MCP endpoint. This step is
 * optional and always complete; the full setup guide is also accessible from
 * Settings → Apps. The step reuses the existing `SetupGuideModal`.
 */
export function McpSetupStep() {
  const { data: config } = useSuspenseQuery(publicConfigQueryOptions());
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {m.onboarding_mcp_setup_heading()}
        </h2>
        <p className="text-sm text-muted-foreground">{m.onboarding_mcp_setup_intro()}</p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">
          {m.onboarding_mcp_setup_endpoint_label()}
        </p>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center border-e border-border px-3.5 text-muted-foreground">
            <PlugIcon className="size-3.5" aria-hidden="true" />
          </div>
          <div
            className="min-w-0 flex-1 truncate px-3.5 py-3 font-mono text-[13px] text-foreground"
            title={config.mcpEndpointUrl}
          >
            {config.mcpEndpointUrl}
          </div>
          <CopyButton
            value={config.mcpEndpointUrl}
            label={m.onboarding_mcp_setup_copy()}
            copiedLabel={m.onboarding_mcp_setup_copied()}
            variant="ghost"
            className="h-auto shrink-0 gap-1.5 rounded-none border-0 border-s border-border bg-muted px-3.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          />
        </div>
      </div>

      <Button variant="outline" className="w-fit" onClick={() => setGuideOpen(true)}>
        {m.onboarding_mcp_setup_guide_button()}
      </Button>

      <SetupGuideModal
        endpoint={config.mcpEndpointUrl}
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}
